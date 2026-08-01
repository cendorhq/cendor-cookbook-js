/**
 * contextkit-eviction-receipt (JS) — read the receipt, not the vibes.
 *
 * Everyone writes the same helper eventually: "if the prompt is too long, drop some history". Then a
 * bug report arrives — the model forgot the system rules, or the retrieved doc it needed is missing —
 * and there is nothing to look at. Which block went? Why that one?
 *
 * contextkit makes the packing declarative and hands back a RECEIPT. Each block declares:
 *
 *   priority   higher survives longer (the eviction order)
 *   pin        never evicted, at any budget (throws BudgetError if the pins alone don't fit)
 *   evict      what to do when this block must shrink — drop_oldest / truncate / summarize / compress
 *   keep       which end of a truncated block to keep, 'head' or 'tail'
 *
 * and report() returns an AssemblyReport: the budget, the tokens actually used, the output reserve,
 * and a BlockDecision per block (action, tokensBefore, tokensAfter, note).
 *
 * whatif(n) answers "what would a tighter budget cost me?" without committing — and is side-effect
 * free (the committed report is untouched).
 *
 * Offline: pure assembly, no model call. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';

import { Block, Context } from '@cendor/contextkit';
import { tokens } from '@cendor/core';

const MODEL = 'gpt-4o';

const RULES = 'You are a support agent. Never promise a refund without checking the policy.';
const POLICY = `Refund policy, section 4: ${'orders are refundable within 30 days of delivery. '.repeat(60)}`;
const RETRIEVED = `Knowledge base article 88: ${'the customer must return the item first. '.repeat(120)}`;
const HISTORY = Array.from({ length: 24 }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: `turn ${i}: ${'chatter '.repeat(14)}`,
}));

function build(budgetTokens) {
  return (
    new Context({ budgetTokens, model: MODEL, reserveOutput: 200 })
      // Pinned: the rules are the reason the agent behaves at all. Never evict them.
      .add(new Block(RULES, { role: 'system', pin: true, priority: 100 }))
      // High priority, but truncatable if it must shrink (the top of the policy matters most).
      .add(new Block(POLICY, { role: 'system', priority: 80, evict: 'truncate', keep: 'head' }))
      // A retrieved doc: useful, but the first thing to go.
      .add(new Block(RETRIEVED, { role: 'user', priority: 10, evict: 'truncate', keep: 'head' }))
      // Conversation history: drop the oldest turns, keep the recent ones.
      .add(new Block({ messages: HISTORY, priority: 50, evict: 'drop_oldest' }))
  );
}

const ctx = build(1200);
const messages = await ctx.assemble();
const receipt = ctx.report();

const raw = tokens.count(RULES + POLICY + RETRIEVED, MODEL) + tokens.count(HISTORY, MODEL);
console.log(`raw input        : ${raw.toLocaleString('en-US')} tokens`);
console.log(
  `budget           : ${receipt.budget} tokens (${receipt.reservedOutput} reserved for the answer)`,
);
console.log(`used             : ${receipt.used} tokens in ${messages.length} messages`);
console.log('the receipt      :');
for (const d of receipt.decisions) {
  const note = d.note ? `  # ${d.note}` : '';
  const arrow = `${String(d.tokensBefore).padStart(5)} -> ${String(d.tokensAfter).padEnd(5)}`;
  console.log(`  [${d.action.padEnd(10)}] ${d.role.padEnd(9)} ${arrow} tok${note}`);
}

// whatif(): price a tighter budget without committing to it.
const committed = receipt.used;
const projections = [];
for (const b of [1200, 800, 500, 300]) projections.push([b, (await ctx.whatif(b)).used]);
console.log(`whatif()         : ${projections.map(([b, u]) => `${b}->${u}`).join(', ')}`);
console.log(`                   committed report untouched: ${ctx.report().used === committed}`);

const pinned = receipt.decisions.find((d) => d.role === 'system' && d.action === 'kept');
assert.ok(pinned, 'the pinned system block was not kept — the whole point of pin:true');
console.log(
  `pinned block     : ${pinned.action} at every budget - it is the reason the agent works`,
);

if (receipt.used > receipt.budget - receipt.reservedOutput)
  throw new Error('the assembly overshot');
assert.ok(
  receipt.decisions.some((d) => d.action !== 'kept'),
  'nothing was evicted',
);
for (let i = 0; i < projections.length - 1; i++) {
  if (projections[i][1] < projections[i + 1][1])
    throw new Error('whatif() used grew as the budget shrank');
}
assert.equal(ctx.report().used, committed, 'whatif() mutated the committed report');
assert.ok(JSON.stringify(messages).includes(RULES), 'the pinned block was evicted');
