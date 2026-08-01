/**
 * task-adherence (JS) — is this tool call on-task? (a BYO-judge alignment check)
 *
 * Agents drift. The user asks to *book a flight*; a few turns later the model proposes
 * `delete_account(...)`. Content filters do not catch this — the call is not unsafe, it is just
 * **not what the user asked for**.
 *
 * `judge.taskAdherence(respond)` compares a proposed tool call against the run's originating
 * instruction, using a model you supply. Like every judge here, that model is instrumented, so the
 * alignment check's own spend is measured on the same bus.
 *
 * Offline: a fake judge model + a cassette. No key, no network.
 * Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as cassette from '@cendor/cassette';
import { bus, instrument } from '@cendor/core';
import { evaluateAsync, judge, rules } from '@cendor/guardrails';
import { report, reset as tgReset } from '@cendor/tokenguard';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'adherence.json');
const INSTRUCTION = 'Book me a flight to Paris next Friday.';

/**
 * A fake instrumented "small model" standing in for your real alignment judge. It reads the
 * proposed call from the user message and returns the strict-JSON verdict `taskAdherence` reads.
 */
function judgeClient() {
  return instrument({
    chat: {
      completions: {
        create: async (kwargs) => {
          const proposed = String(kwargs.messages.at(-1)?.content ?? '').toLowerCase();
          const aligned = proposed.includes('search_flights') || proposed.includes('book_flight');
          const verdict = {
            trip: !aligned, // trip == misaligned
            reason: aligned
              ? 'on-task: a flight search'
              : 'off-task: unrelated to booking a flight',
          };
          return {
            choices: [{ message: { content: JSON.stringify(verdict) } }],
            usage: { prompt_tokens: 60, completion_tokens: 12 },
          };
        },
      },
    },
  });
}

/** Your `respond(system, user)`: prompt the (instrumented) judge model, return its reply. */
function makeRespond(client) {
  return async (system, user) => {
    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return resp.choices[0].message.content;
  };
}

/**
 * ⚠️ `Context` is a plain OBJECT in TypeScript, not a class — Python constructs
 * `Context(stage=…, tool=…, tool_args=…, instruction=…)`; here it is an object literal with
 * camelCase keys (`toolArgs`). And `evaluateAsync` returns `{ payload, decisions }`, not a tuple.
 */
async function screen(rail, tool, args) {
  const ctx = { stage: 'tool_call', tool, toolArgs: args, instruction: INSTRUCTION };
  const { decisions } = await evaluateAsync([rail], 'tool_call', args, ctx);
  const flags = decisions.filter((d) => d.action === 'flag');
  return flags.length ? `flagged: ${flags.at(-1)?.reason}` : 'aligned';
}

/** Screen both proposed calls in one cassette session — recorded once, replayed thereafter. */
function runSession(rail) {
  return cassette.use(FIXTURE, { mode: 'auto' })(async () => [
    ['aligned', await screen(rail, 'search_flights', { to: 'Paris', when: 'next Friday' })],
    ['off-task', await screen(rail, 'delete_account', { user: 'self' })],
  ])();
}

bus._reset();
tgReset();
const check = judge.taskAdherence(makeRespond(judgeClient()));
const rail = rules.llmJudge(check, { stage: 'tool_call', action: 'flag', name: 'task_adherence' });

const outcomes = await runSession(rail);
for (const [label, outcome] of outcomes) console.log(`${label.padEnd(9)} -> ${outcome}`);

const spend = report();
const calls = spend.rows.reduce((n, r) => n + r.calls, 0);
const tokens = spend.rows.reduce((n, r) => n + r.tokens, 0);
console.log(
  `\nthe alignment judge's own spend is budgeted + attributed (${calls} call(s), ${tokens} tokens) ` +
    '— the safety check is itself measured. No adherence-rate claim: it is a BYO judge, only as ' +
    'good as its model + prompt.',
);

const byLabel = Object.fromEntries(outcomes);
// BOTH halves matter. A rail that flags everything would satisfy the second assertion alone, and
// would be useless — an agent that cannot call any tool is not aligned, it is broken.
assert.equal(byLabel.aligned, 'aligned', 'an on-task tool call was flagged as drift');
assert.ok(
  byLabel['off-task'].startsWith('flagged:'),
  'delete_account was NOT flagged against a flight-booking instruction',
);
assert.ok(calls >= 2, `the judge's own calls did not reach the bus (got ${calls})`);
assert.ok(tokens > 0, "the judge's token usage was not recorded");
