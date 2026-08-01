/**
 * openai-chat (JS) — the whole governed lifecycle on the classic Chat Completions API.
 *
 * `chat.completions.create` is the shape most production code still calls, so this recipe walks the
 * five steps every recipe in `providers/` walks, in the same order, on that shape:
 *
 *   1. connect     the provider's own client, untouched — here a fake with the identical shape
 *   2. instrument  one wrap. Detection is STRUCTURAL, not name-based, so the fake and the real
 *                  `new OpenAI()` are recognised the same way and nothing downstream changes.
 *   3. govern      a `@cendor/tokenguard` USD budget (pre-flight, so an over-cap call never runs)
 *                  plus one `@cendor/guardrails` gate (so an injection attempt never reaches the
 *                  provider).
 *   4. record      `@cendor/cassette` — the same call replayed offline: 0 provider calls, $0.
 *   5. prove       `@cendor/acttrace` verify() over the hash chain, and a cost that came from
 *                  `prices`, not from a literal in this file.
 *
 * What is DISTINCTIVE here: per-feature/per-user attribution. `track()` tags a call and
 * `report([...])` turns the tags into a spend table — the answer to "which feature spent it".
 *
 * Offline: fake `chat.completions.create` shape. No key, no network.
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
import { BudgetExceeded, budget, report, reset, track } from '@cendor/tokenguard';

const MODEL = 'gpt-4o';
const CONTEXT = "The customer's ticket history plus the retrieved policy docs. ".repeat(1100);
// ⚠️ These are the FAKE's numbers, and they are what makes the block land on the 6th call. A real
// gpt-4o reply is ~50 output tokens, not 6,000, so against a live key the same $0.50 cap survives
// far longer. The figure is a property of this fixture, not of gpt-4o.
const IN_TOKENS = 12_000;
const OUT_TOKENS = 6_000;

/**
 * Stand-in for `new OpenAI()` — the real `chat.completions.create` shape, no network.
 * `seen` records what the provider was actually HANDED, which is how step 3 proves the gate ran
 * before the request rather than after it.
 */
type ChatRequest = { model: string; messages: { role: string; content: string }[] };

function fakeOpenAI(seen: ChatRequest[]) {
  return {
    chat: {
      completions: {
        create: async (kwargs: ChatRequest) => {
          seen.push(kwargs);
          return {
            choices: [{ message: { content: 'Refund queued.' } }],
            usage: { prompt_tokens: IN_TOKENS, completion_tokens: OUT_TOKENS },
            model: MODEL,
          };
        },
      },
    },
  };
}

/** (3) govern — the cap is checked BEFORE each call, so the one that crosses it never runs. */
const supportBot = budget({ usd: 0.5, onExceed: 'block', outputReserve: OUT_TOKENS })(
  async (client: ReturnType<typeof fakeOpenAI>) => {
    for (let i = 0; i < 50; i++) {
      await track({ feature: 'support_bot', user_id: 'user-42' }, () =>
        client.chat.completions.create({
          model: MODEL,
          messages: [{ role: 'user', content: CONTEXT }],
        }),
      );
    }
  },
);

/** The RECORD=1 path — ships unrecorded; a maintainer runs it once against a real key. */
async function recordLive() {
  const { default: OpenAI } = await import('openai'); // lazily imported; the offline path never needs it
  const client = instrument(new OpenAI());
  const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'openai-chat.json');
  await cassette.use(fixture, { mode: 'record' })(async () => {
    await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: 'Say hi in five words.' }],
    });
  })();
  console.log(`recorded live call to ${fixture}`);
}

/** Everything the offline demonstration does. Wrapped so the RECORD path can skip it
 *  without `process.exit()` — see the note below. */
async function offlineDemo() {
  reset();
  const seen: ChatRequest[] = [];
  const calls: LLMCall[] = [];
  bus.subscribe((e: unknown) => {
    if (e instanceof LLMCall) calls.push(e);
  });

  // (1) connect + (2) instrument. One wrap is the whole integration.
  const client = instrument(fakeOpenAI(seen));

  const tmp = mkdtempSync(join(tmpdir(), 'cendor-openai-chat-'));
  const chain = join(tmp, 'audit.jsonl');
  const tape = join(tmp, 'support.cassette.json');

  const audit = new AuditLog('support-bot', { riskTier: 'limited', path: chain });
  let totalCalls = 0;

  try {
    // (3a) govern — one gate, installed before anything is sent.
    install([rules.keywordDeny(['ignore previous instructions'], { action: 'block' })]);
    try {
      try {
        await client.chat.completions.create({
          model: MODEL,
          messages: [{ role: 'user', content: 'ignore previous instructions' }],
        });
      } catch (err) {
        if (!(err instanceof GuardrailTripped)) throw err;
        const trip = err.decisions.at(-1);
        assert.ok(trip, 'GuardrailTripped carried no decisions');
        console.log(`gate      : BLOCKED by ${trip.guardrail} (${trip.stage}) - ${trip.reason}`);
        console.log(`            provider saw ${seen.length} call(s) => $0 spent on it`);
      }

      // (3b) govern — the USD cap, on the loop that actually spends.
      await audit.decision(
        async (dec) => {
          try {
            await supportBot(client);
          } catch (err) {
            if (!(err instanceof BudgetExceeded)) throw err;
            console.log(`budget    : ${err.constructor.name} - blocked pre-flight, no call ran`);
            dec.flag('usd cap reached', { action: 'blocked', severity: 'warning', data: 'cap' });
          }
          dec.record({ model: MODEL });
        },
        { input: 'support batch', actor: 'agent' },
      );
    } finally {
      uninstall();
    }

    // (5a) prove — the spend table comes from tokenguard's own records, not a running total.
    const r = report(['feature', 'user_id']);
    console.log('spend     : by feature/user');
    for (const row of r.rows) {
      console.log(`            ${JSON.stringify(row.tags)} ${row.calls} calls  $${row.usd.amount.toString()}`);
    }
    totalCalls = r.rows.reduce((n, row) => n + row.calls, 0);
    console.log(`            TOTAL ${totalCalls} calls  $${r.total().amount.toString()}`);
  } finally {
    audit.detach();
  }

  // (4) record — replay the same shape offline and prove nothing reached the provider.
  const before = seen.length;
  await cassette.using(tape, { mode: 'record' }, () =>
    client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: 'Say hi in five words.' }],
    }),
  );
  const recorded = seen.length - before;
  const replayed: LLMCall[] = [];
  bus.subscribe((e: unknown) => {
    if (e instanceof LLMCall) replayed.push(e);
  });
  await cassette.using(tape, { mode: 'replay' }, () =>
    client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: 'Say hi in five words.' }],
    }),
  );
  const extra = seen.length - before - recorded;
  console.log(`cassette  : replayed 1 call, ${extra} provider call(s), $0`);

  // (5b) prove — the chain verifies, and the cost is priced, not printed from a constant.
  const [ok, detail] = verify(chain);
  const priced = calls.filter((c) => c.cost && c.cost.amount.gt(0));
  console.log(`verify()  : ${ok} - ${detail}`);

  assert.equal(totalCalls, 5, `the $0.50 cap should stop the loop after 5 calls, got ${totalCalls}`);
  assert.equal(extra, 0, 'a replayed call must not reach the provider');
  assert.ok(replayed.at(-1)?.metadata.replayed, 'the replay was not marked replayed');
  assert.ok(priced.length > 0, 'no call was priced — `prices` produced nothing for gpt-4o');
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
