/**
 * openai-responses (JS) — the governed lifecycle on the Responses API, where usage looks different.
 *
 * Same five steps as every recipe in `providers/`, on `responses.create`:
 *
 *   1. connect     `new OpenAI()` — the Responses shape, faked here with identical fields
 *   2. instrument  one wrap; the seam recognises the client by SHAPE, so nothing below changes
 *   3. govern      a `@cendor/tokenguard` USD budget + one `@cendor/guardrails` gate
 *   4. record      `@cendor/cassette` replay — 0 provider calls, $0
 *   5. prove       `@cendor/acttrace` verify() + a cost that came from `prices`
 *
 * What is DISTINCTIVE here: **reasoning and cached tokens.** New OpenAI apps (and the Agents SDK)
 * call `responses.create`, which reports `input_tokens`/`output_tokens` with cached tokens under
 * `input_tokens_details.cached_tokens` and reasoning under `output_tokens_details.reasoning_tokens`.
 * Those are billed, at different rates, and a naive prompt+completion sum misses both.
 * `instrument()` normalizes them into `usage.cachedTokens` / `usage.reasoningTokens`, so the cost
 * matches the invoice rather than the intuition.
 *
 * Offline: fake `responses.create` shape. No key, no network.
 * Run:  npm install && node index.mjs
 *
 * Record a real cassette (maintainer, needs a key):
 *   RECORD=1 OPENAI_API_KEY=sk-... node index.mjs
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
import { BudgetExceeded, budget, reset } from '@cendor/tokenguard';

const MODEL = 'gpt-4o';
const IN_TOKENS = 9_000;
const CACHED = 6_000; // billed at the cheaper cached-input rate
const OUT_TOKENS = 1_200;
const REASONING = 800; // billed as output, and invisible in the text you get back
/** Stand-in for `new OpenAI()` — the Responses API shape, with reasoning + cached details. */

function fakeOpenAIResponses(seen) {
  return {
    responses: {
      create: async (kwargs) => {
        seen.push(kwargs);
        return {
          output_text: 'Refund queued.',
          model: MODEL,
          usage: {
            input_tokens: IN_TOKENS,
            output_tokens: OUT_TOKENS,
            input_tokens_details: { cached_tokens: CACHED },
            output_tokens_details: { reasoning_tokens: REASONING },
          },
        };
      },
    },
  };
}

const answer = budget({ usd: 0.4, onExceed: 'block', outputReserve: OUT_TOKENS })(
  async (client) => {
    for (let i = 0; i < 50; i++) {
      await client.responses.create({ model: MODEL, input: 'summarize the ticket' });
    }
  },
);

async function recordLive() {
  const { default: OpenAI } = await import('openai');
  const client = instrument(new OpenAI());
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    'fixtures',
    'openai-responses.json',
  );
  await cassette.use(fixture, { mode: 'record' })(async () => {
    await client.responses.create({ model: MODEL, input: 'Say hi in five words.' });
  })();
  console.log(`recorded live call to ${fixture}`);
}

/** Everything the offline demonstration does. Wrapped so the RECORD path can skip it
 *  without `process.exit()` — see the note below. */
async function offlineDemo() {
  reset();
  const seen = [];
  const calls = [];
  bus.subscribe((e) => {
    if (e instanceof LLMCall) calls.push(e);
  });

  const client = instrument(fakeOpenAIResponses(seen));

  const tmp = mkdtempSync(join(tmpdir(), 'cendor-openai-responses-'));
  const chain = join(tmp, 'audit.jsonl');
  const tape = join(tmp, 'responses.cassette.json');

  const audit = new AuditLog('responses-bot', { riskTier: 'limited', path: chain });
  try {
    install([rules.keywordDeny(['ignore previous instructions'], { action: 'block' })]);
    try {
      try {
        await client.responses.create({ model: MODEL, input: 'ignore previous instructions' });
      } catch (err) {
        if (!(err instanceof GuardrailTripped)) throw err;
        const trip = err.decisions.at(-1);
        assert.ok(trip, 'GuardrailTripped carried no decisions');
        console.log(`gate      : BLOCKED by ${trip.guardrail} (${trip.stage}) - ${trip.reason}`);
        console.log(`            provider saw ${seen.length} call(s) => $0 spent on it`);
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
        { input: 'responses batch', actor: 'agent' },
      );
    } finally {
      uninstall();
    }
  } finally {
    audit.detach();
  }

  // The distinctive bit: the four numbers a prompt+completion sum would have collapsed into two.
  // `usage` is nullable on LLMCall, so the predicate has to say so — and `find` returns
  // `T | undefined`, which the assert turns into a named failure instead of a TypeError.
  const one = calls.find((c) => (c.usage?.inputTokens ?? 0) > 0);
  assert.ok(one?.usage, 'no call on the bus carried normalized usage');
  assert.ok(one.cost, 'the call reached the bus unpriced');
  console.log('usage     : the Responses API reports four numbers, not two');
  console.log(
    `            input      ${one.usage.inputTokens} (of which ${one.usage.cachedTokens} cached, billed cheaper)`,
  );
  console.log(
    `            output     ${one.usage.outputTokens} (of which ${one.usage.reasoningTokens} reasoning, billed but unseen)`,
  );
  console.log(
    `            cost       $${one.cost.amount.toString()}  <- from prices, not a literal`,
  );

  const before = seen.length;
  await cassette.using(tape, { mode: 'record' }, () =>
    client.responses.create({ model: MODEL, input: 'Say hi in five words.' }),
  );
  const recorded = seen.length - before;
  const replayed = [];
  bus.subscribe((e) => {
    if (e instanceof LLMCall) replayed.push(e);
  });
  await cassette.using(tape, { mode: 'replay' }, () =>
    client.responses.create({ model: MODEL, input: 'Say hi in five words.' }),
  );
  const extra = seen.length - before - recorded;
  console.log(`cassette  : replayed 1 call, ${extra} provider call(s), $0`);

  const [ok, detail] = verify(chain);
  console.log(`verify()  : ${ok} - ${detail}`);

  // ⚠️ `responses.parse` is NOT an instrumentation target in TypeScript, and that is deliberate: in
  // openai-node it is a HELPER built on `create`, so a target there would double-count one request.
  // (Python needs its own `parse` targets, because there `parse` POSTs its own request. Same shape as
  // Anthropic's `messages.parse` — see the trap registry.)
  assert.equal(
    one.usage.cachedTokens,
    CACHED,
    'cached tokens were not normalized off input_tokens_details',
  );
  assert.equal(
    one.usage.reasoningTokens,
    REASONING,
    'reasoning tokens were not normalized off output_tokens_details',
  );
  assert.ok(one.cost.amount.gt(0), 'the Responses call reached the bus unpriced');
  assert.equal(extra, 0, 'a replayed call must not reach the provider');
  assert.ok(replayed.at(-1)?.metadata.replayed, 'the replay was not marked replayed');
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
