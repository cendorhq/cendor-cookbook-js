/**
 * gemini (JS) — the governed lifecycle on `@google/genai`, whose usage shape shares nothing with
 * OpenAI.
 *
 * Same five steps as every recipe in `providers/`, on `models.generateContent`:
 *
 *   1. connect     `new GoogleGenAI()` — faked here with the identical shape
 *   2. instrument  one wrap; detection is structural, so nothing below is Gemini-aware
 *   3. govern      a `@cendor/tokenguard` USD budget + one `@cendor/guardrails` gate
 *   4. record      `@cendor/cassette` replay — 0 provider calls, $0
 *   5. prove       `@cendor/acttrace` verify() + a cost that came from `prices`
 *
 * What is DISTINCTIVE here: **a completely different usage shape, and a cumulative stream.**
 * There is no `usage`; there is `usageMetadata` with `promptTokenCount` / `candidatesTokenCount`,
 * and the call is `client.models.generateContent({ model, contents })`.
 *
 * ⚠️ **Streaming is its own method** (`generateContentStream`) — not a `stream: true` flag — and,
 * unlike OpenAI's deltas, **each chunk reports usage CUMULATIVELY**: the running total, not the
 * increment. Summing the chunks would over-count enormously. `instrument()` takes the last value
 * rather than adding them up, so the budget, the report and the audit chain are the same three
 * lines you would write for OpenAI.
 *
 * Offline: fake `new GoogleGenAI()` shape. No key, no network.
 * Run:  npm install && node index.mjs
 *
 * Record a real cassette (maintainer, needs a key):
 *   RECORD=1 GOOGLE_API_KEY=... node index.mjs      # GEMINI_MODEL optional
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AuditLog, verify } from '@cendor/acttrace';
import * as cassette from '@cendor/cassette';
import { LLMCall, bus, instrument } from '@cendor/core';
import { GuardrailTripped, install, rules, uninstall } from '@cendor/guardrails';
import { BudgetExceeded, budget, report, reset, track } from '@cendor/tokenguard';

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
const SIGNING_KEY = process.env.CENDOR_DEMO_KEY ?? 'demo-signing-key';
const IN_TOKENS = 14_000;
const OUT_TOKENS = 2_000;

const providerCalls = { n: 0 };
/**
 * Stand-in for `new GoogleGenAI()`. Note `usageMetadata`, camelCase, and NOT under a `usage` key —
 * an OpenAI reader looking for `usage.prompt_tokens` finds nothing at all here.
 *
 * `generateContentStream` returns an async iterable whose chunks carry the RUNNING TOTAL. The three
 * chunks below report 400 → 1,200 → 2,000 output tokens: the true answer is 2,000, and a summing
 * implementation would say 3,600.
 */
/** Gemini's request shape: `contents`, not `messages`. */

function fakeGenAI() {
  const models = {
    generateContent: async (_req) => {
      providerCalls.n++;
      return {
        text: 'Refund queued.',
        usageMetadata: {
          promptTokenCount: IN_TOKENS,
          candidatesTokenCount: OUT_TOKENS,
          totalTokenCount: IN_TOKENS + OUT_TOKENS,
        },
      };
    },
    generateContentStream: async (_req) => {
      providerCalls.n++;
      return (async function* () {
        for (const running of [400, 1200, 2000]) {
          yield {
            text: 'chunk ',
            usageMetadata: {
              promptTokenCount: IN_TOKENS,
              candidatesTokenCount: running, // CUMULATIVE, not a delta
              totalTokenCount: IN_TOKENS + running,
            },
          };
        }
      })();
    },
  };
  return { models };
}

const answer = budget({ usd: 0.5, onExceed: 'block', outputReserve: OUT_TOKENS })(
  async (client) => {
    for (let i = 0; i < 200; i++) {
      await track({ feature: 'summarizer' }, () =>
        client.models.generateContent({ model: MODEL, contents: 'summarize the ticket thread' }),
      );
    }
  },
);

async function recordLive() {
  const { GoogleGenAI } = await import('@google/genai');
  const client = instrument(new GoogleGenAI({}));
  const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'gemini.json');
  await cassette.use(fixture, { mode: 'record' })(async () => {
    await client.models.generateContent({ model: MODEL, contents: 'Say hi in five words.' });
  })();
  console.log(`recorded live call to ${fixture}`);
}

/** Everything the offline demonstration does. Wrapped so the RECORD path can skip it
 *  without `process.exit()` — see the note below. */
async function offlineDemo() {
  reset();
  const calls = [];
  bus.subscribe((e) => {
    if (e instanceof LLMCall) calls.push(e);
  });

  const client = instrument(fakeGenAI());

  const tmp = mkdtempSync(join(tmpdir(), 'cendor-gemini-'));
  const chain = join(tmp, 'audit.jsonl');
  const tape = join(tmp, 'gemini.cassette.json');

  const audit = new AuditLog('gemini-bot', {
    riskTier: 'limited',
    path: chain,
    signingKey: SIGNING_KEY,
  });
  let totalCalls = 0;
  try {
    install([rules.keywordDeny(['ignore previous instructions'], { action: 'block' })]);
    try {
      try {
        await client.models.generateContent({
          model: MODEL,
          contents: 'ignore previous instructions',
        });
      } catch (err) {
        if (!(err instanceof GuardrailTripped)) throw err;
        const trip = err.decisions.at(-1);
        assert.ok(trip, 'GuardrailTripped carried no decisions');
        console.log(`gate      : BLOCKED by ${trip.guardrail} (${trip.stage}) - ${trip.reason}`);
        console.log(`            provider saw ${providerCalls.n} call(s) => $0 spent on it`);
      }
      await audit.decision(
        async (dec) => {
          try {
            await answer(client);
          } catch (err) {
            if (!(err instanceof BudgetExceeded)) throw err;
            console.log(`budget    : ${err.constructor.name} - blocked pre-flight, no call ran`);
            dec.flag('usd cap reached', { action: 'blocked', severity: 'warning', data: 'cap' });
          }
          dec.record({ model: MODEL });
        },
        { input: 'gemini batch', actor: 'agent' },
      );
    } finally {
      uninstall();
    }
    const r = report(['feature']);
    totalCalls = r.rows.reduce((n, row) => n + row.calls, 0);
    console.log(
      `spend     : ${totalCalls} calls  $${r.total().amount.toString()} (usageMetadata normalized onto the same bus)`,
    );
  } finally {
    audit.detach();
  }

  // The distinctive bit, measured: a cumulative stream must NOT be summed.
  const nonStream = calls.filter((c) => (c.usage?.outputTokens ?? 0) > 0).length;
  const stream = await client.models.generateContentStream({ model: MODEL, contents: 'stream it' });
  let chunks = 0;
  for await (const _ of stream) chunks++;
  const streamed = calls.at(-1);
  assert.ok(streamed?.usage, 'the stream produced no LLMCall with usage');
  console.log(
    `stream    : ${chunks} chunks, each reporting the RUNNING total (400 -> 1200 -> 2000)`,
  );
  console.log(
    `            recorded output = ${streamed.usage.outputTokens}, not ${400 + 1200 + 2000} — the last value wins, sums do not`,
  );

  const before = providerCalls.n;
  await cassette.using(tape, { mode: 'record' }, () =>
    client.models.generateContent({ model: MODEL, contents: 'Say hi in five words.' }),
  );
  const recorded = providerCalls.n - before;
  await cassette.using(tape, { mode: 'replay' }, () =>
    client.models.generateContent({ model: MODEL, contents: 'Say hi in five words.' }),
  );
  const extra = providerCalls.n - before - recorded;
  console.log(`cassette  : replayed 1 call, ${extra} provider call(s), $0`);

  const [ok, detail] = verify(chain, { key: SIGNING_KEY });
  console.log(`verify()  : ${ok} - ${detail}`);

  assert.ok(nonStream > 0, 'no Gemini call was normalized — usageMetadata was not read at all');
  assert.equal(
    streamed.usage.outputTokens,
    2000,
    `a cumulative stream must report its LAST value (2000), not the sum (3600); got ${streamed.usage.outputTokens}`,
  );
  assert.ok(
    calls.some((c) => c.cost?.amount.gt(0)),
    'no Gemini call was priced',
  );
  assert.equal(extra, 0, 'a replayed call must not reach the provider');
  assert.equal(ok, true, 'the audit chain failed verify()');
}

// ⚠️ NO `process.exit(0)` HERE. Calling it while the provider SDK's keep-alive socket is still
// closing aborts node on Windows with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` —
// and it does so AFTER the cassette has been written, so a perfectly good recording looks like a
// crash. Measured on the 2026-08-01 live sweep across five providers. Dispatch instead, and let the
// module end normally so node drains its own handles.
if (process.env.RECORD === '1') {
  await recordLive();
} else {
  await offlineDemo();
}
