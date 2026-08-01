/**
 * @cendor/contextkit quickstart (JS) — fit a prompt to a token budget without dropping the wrong
 * things.
 *
 * Naive truncation lops off the end of your prompt — often the pinned instructions or the user's
 * actual question. contextkit assembles blocks by priority, shrinks what it is allowed to, drops
 * what it must, and hands back a receipt. Same inputs -> identical output.
 *
 * Offline: pure token math, no model call. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';

import { Block, Context } from '@cendor/contextkit';

const SYSTEM_PROMPT = 'You are a meticulous support agent. Cite the policy for every answer.';
const USER_MSG = 'I was charged twice for order #8823 — can you refund the duplicate?';

// A big retrieved-docs blob and a long chat history — together they blow the budget, so contextkit
// must shrink the docs (truncate) and peel the oldest chat turns (dropOldest).
const DOCS = `Refund policy. ${'Duplicate charges are refunded within 5 business days. '.repeat(900)}`;
const TURN = 'discussing the refund timeline and the duplicate-charge policy. ';
const HISTORY = Array.from({ length: 40 }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: `turn ${i}: ${TURN.repeat(12)}`,
}));

async function build() {
  const ctx = new Context({ budgetTokens: 8000, model: 'gpt-4o', reserveOutput: 500 });
  ctx.add(new Block(SYSTEM_PROMPT, { priority: 10, pin: true, role: 'system' })); // never dropped
  ctx.add(new Block(DOCS, { priority: 5, evict: 'truncate', role: 'user' })); //     shrink to fit
  ctx.add(new Block({ messages: HISTORY, priority: 3, evict: 'drop_oldest' })); //   peel oldest turns
  ctx.add(new Block(USER_MSG, { priority: 9, pin: true, role: 'user' })); //         never dropped
  await ctx.assemble();
  return ctx;
}

const ctx = await build();
const report = ctx.report();

console.log(report.toString()); // the receipt: kept / truncated / dropped per block
console.log();
const ok = report.used <= report.budget - report.reservedOutput;
console.log(
  `used ${report.used} <= budget ${report.budget - report.reservedOutput} ` +
    `(after ${report.reservedOutput}-tok output reserve)  ${ok ? 'OK' : 'OVER'}`,
);

// Determinism: identical inputs -> byte-identical assembled messages.
const a = await (await build()).assemble();
const b = await (await build()).assemble();
const identical = JSON.stringify(a) === JSON.stringify(b);
console.log(`same inputs -> identical output: ${identical}`);

assert.ok(ok, 'assembled prompt must fit the budget');
assert.ok(identical, 'assembly must be deterministic');
// A receipt that recorded nothing would pass the two lines above just as happily.
assert.equal(report.decisions.length, 4, 'the receipt should carry one line per block');
assert.ok(
  report.decisions.some((d) => d.action === 'truncated'),
  'the oversized docs block was not shrunk — the budget was met some other way',
);
