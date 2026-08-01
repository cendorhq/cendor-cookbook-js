/**
 * @cendor/tokenguard quickstart (JS) — stop a runaway agent loop *before* it overspends.
 *
 * A loop that retries, re-plans and re-reads its own context can burn a month's budget in an
 * afternoon, and you find out from the invoice. tokenguard prices every instrumented call against a
 * cap and refuses the one that would cross it — pre-flight, so the request never leaves the process.
 *
 * Offline: the "OpenAI" client is a fake provider-shaped object. No key, no network.
 * Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';

import { instrument } from '@cendor/core';
import { BudgetExceeded, budget, report, reset, track } from '@cendor/tokenguard';

// Each simulated turn sends ~12k input tokens and reserves 6k output on gpt-4o. tokenguard prices
// that from the offline snapshot at ~$0.09/turn — so a $0.50 cap is crossed on the 6th turn. With
// onExceed: 'block' the projection is checked BEFORE the call, so the 6th turn is refused and never
// reaches the model.
//
// ⚠️ THE "6th TURN" IS A PROPERTY OF THIS FAKE, NOT OF A REAL PROVIDER. `OUT_TOKENS = 6_000` is what
// the fake *reports as settled usage*, and tokenguard bills what settles. A real model asked this
// question answers in 30–60 tokens, so real spend is ~$0.016/turn, not $0.09 — the cap is then
// crossed around the **27th** turn. Measured live 2026-07-31. Nothing is wrong with tokenguard here:
// `outputReserve` governs the pre-flight *projection*, settled usage governs the *record*, and the
// two are meant to differ. Against a real client, set the cap from a measured per-turn cost rather
// than reusing $0.50, or read the block as "projected", not "spent".
const CONTEXT = 'The support ticket thread and the product knowledge-base docs. '.repeat(1090);
const IN_TOKENS = 12_000;
const OUT_TOKENS = 6_000;

/** A stand-in for `new OpenAI()` — same `chat.completions.create` shape, no network. */
function fakeOpenAI() {
  return {
    chat: {
      completions: {
        create: async () => ({
          usage: { prompt_tokens: IN_TOKENS, completion_tokens: OUT_TOKENS },
        }),
      },
    },
  };
}

// ⚠️ `budget` is CURRIED in TypeScript — `budget(cfg)(fn)`, never `budget(cfg, fn)`. The two-argument
// shape is a decoy overload typed `never` so the wrong call is a compile error rather than a runtime
// surprise. For a callback scope use `withBudget(cfg, cb)`.
const runAgentLoop = budget({ usd: 0.5, onExceed: 'block', outputReserve: OUT_TOKENS })(
  async (client) => {
    for (let i = 0; i < 50; i++) {
      // a loop that would happily run forever
      const feature = i % 2 === 0 ? 'planner' : 'researcher';
      await track({ feature }, () =>
        client.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: CONTEXT }],
        }),
      );
    }
  },
);

reset();
const client = instrument(fakeOpenAI());

let blocked = null;
try {
  await runAgentLoop(client);
} catch (err) {
  if (!(err instanceof BudgetExceeded)) throw err;
  blocked = err;
  console.log(`${err.constructor.name}: ${err.message}\n`);
}

const r = report(['feature']);
console.log('Turns that actually ran, by feature:');
for (const row of [...r.rows].sort((a, b) => String(a.tags.feature).localeCompare(String(b.tags.feature)))) {
  console.log(`  ${String(row.tags.feature).padEnd(11)} ${row.calls} calls   $${row.usd.amount.toString()}`);
}
const ran = r.rows.reduce((n, row) => n + row.calls, 0);
console.log(`  ${'TOTAL'.padEnd(11)} ${ran} calls   $${r.total().amount.toString()}`);
console.log('\n(The 6th turn was blocked pre-flight - $0 spent on it; the model never saw it.)');

// Prove it rather than print it. `ran` is what tokenguard RECORDED, so if the pre-flight block ever
// stopped working this line fails instead of the paragraph above quietly becoming false.
assert.notEqual(blocked, null, 'the $0.50 cap was never enforced — no BudgetExceeded was raised');
assert.equal(ran, 5, `the $0.50 cap should let 5 turns through and block the 6th, got ${ran}`);
assert.ok(r.total().amount.gt(0), 'no spend was recorded at all');
// Money is decimal.js, never a float.
assert.equal(typeof r.total().amount.toString(), 'string');
