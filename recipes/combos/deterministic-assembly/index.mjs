/**
 * deterministic-assembly (JS) — why a replay is worth anything at all.
 *
 * A cassette replays by hashing the request. If prompt assembly is not deterministic — eviction ties
 * breaking on key order, a summarizer paraphrasing differently each run — then run 2 hashes
 * differently, the cassette misses, and you are back to paying for a live call. Worse, it misses
 * SILENTLY: you assume the test is offline and it is not.
 *
 * @cendor/contextkit's packing is deterministic by construction. Measured here rather than claimed:
 * the same 40-turn conversation is assembled twice into a budget too small to hold it (so real
 * eviction happens — the hard case), both assembled prompts are hashed, then a cassette recorded
 * from run 1 is replayed against RUN 2's prompt with a client that throws if it is ever reached.
 *
 * Change one character of the input and the hash changes; that is the property that makes a recorded
 * test suite trustworthy. Offline, keyless. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cassette from '@cendor/cassette';
import { Block, Context } from '@cendor/contextkit';
import { instrument } from '@cendor/core';

const MODEL = 'gpt-4o';

/** The same context, built from scratch each time — as a real request handler would. */
function build() {
  const turns = Array.from({ length: 40 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `turn ${i}: ${'detail '.repeat(12)}`,
  }));
  return new Context({ budgetTokens: 400, model: MODEL, reserveOutput: 100 })
    .add(new Block('You are terse.', { role: 'system', pin: true, priority: 100 }))
    .add(new Block({ messages: turns, evict: 'drop_oldest' }));
}

const fingerprint = (messages) =>
  createHash('sha256').update(JSON.stringify(messages)).digest('hex');

function provider({ boom = false } = {}) {
  // Declared as ONE expression so TypeScript can infer it: an object that grows properties after
  // `{ calls: 0 }` has already been inferred as having none of them.
  const state = {
    calls: 0,
    client: instrument({
      chat: {
        completions: {
          create: async (_req) => {
            state.calls++;
            if (boom) throw new Error('run 2 hashed differently — assembly is not deterministic');
            return {
              choices: [{ message: { content: 'acknowledged' } }],
              usage: { prompt_tokens: 640, completion_tokens: 6 },
            };
          },
        },
      },
    }),
  };
  return state;
}

const ctx1 = build();
const ctx2 = build();
const run1 = await ctx1.assemble();
const run2 = await ctx2.assemble();
const report = ctx1.report();
const evicted = report.decisions.filter((d) => d.action !== 'kept');

const tape = join(mkdtempSync(join(tmpdir(), 'cendor-recipe-')), 'conversation.json');

const live = provider();
await cassette.using(tape, { mode: 'record' }, () =>
  live.client.chat.completions.create({ model: MODEL, messages: run1 }),
);

const boom = provider({ boom: true });
const out = await cassette.using(tape, { mode: 'replay' }, () =>
  boom.client.chat.completions.create({ model: MODEL, messages: run2 }),
);

// One character changed at the source must change the fingerprint — the negative control.
const nudged = JSON.parse(JSON.stringify(run2));
nudged.at(-1).content += '.';
const same = fingerprint(nudged) === fingerprint(run2);

console.log(`assembled   : ${report.used} tokens of ${report.budget} - ${evicted[0].note}`);
console.log(`run 1 hash  : ${fingerprint(run1).slice(0, 16)}…`);
console.log(
  `run 2 hash  : ${fingerprint(run2).slice(0, 16)}…   identical: ${fingerprint(run1) === fingerprint(run2)}`,
);
console.log(`one char    : ${fingerprint(nudged).slice(0, 16)}…   identical: ${same}`);
console.log(
  `replay      : provider called ${boom.calls}x, answered ${JSON.stringify(out.choices[0].message.content)}`,
);

assert.equal(
  fingerprint(run1),
  fingerprint(run2),
  'assembly is not byte-deterministic across runs',
);
assert.notEqual(
  evicted.length,
  0,
  'nothing was evicted - this would prove determinism on an easy case only',
);
assert.equal(boom.calls, 0, 'run 2 missed the cassette — the assembled prompt hashed differently');
if (same) throw new Error('the fingerprint ignored a real change');
