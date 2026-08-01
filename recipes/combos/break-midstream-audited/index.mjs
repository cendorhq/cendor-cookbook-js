/**
 * break-midstream-audited (JS) — cut a runaway stream mid-flight, and keep the evidence.
 *
 * A pre-flight cap cannot help here. The model was asked for one paragraph and is thousands of
 * tokens into a loop; the request was already approved, and by the time the response settles you
 * have paid. `onExceed: 'break'` is the guard for that shape: tokenguard registers a per-chunk
 * observer on core's stream seam, and when the running output estimate crosses the cap it closes the
 * provider stream, keeps the partial text, and throws ONCE.
 *
 * The cut is a governance action, so acttrace chains it as budget_event(action='broken') on the same
 * tamper-evident file as everything else — and the chain still verifies.
 *
 * `break` is not a replacement for `block` — see ../../libs/tokenguard-hard-vs-runaway.
 * Offline: a fake streaming client, no key. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, verify } from '@cendor/acttrace';
import { instrument } from '@cendor/core';
import { BudgetExceeded, reset, withBudget } from '@cendor/tokenguard';

const MODEL = 'gpt-4o';
const CHUNKS = 60;

/** A provider stream that will not stop. `closed.v` flips when core closes it on the cut — which is
 * what proves the break reached the socket, not just the consumer's loop.
 *
 * Note the mechanism, because it differs from Python. When the observer throws, core's `for await`
 * exits the loop, and JavaScript's **IteratorClose** calls the source iterator's `return()` — which
 * is what a real SDK stream uses to abort its fetch controller. (Python's iterator protocol calls
 * `close()` instead; the same recipe there hangs its flag on that.) */
function runawayClient() {
  const closed = { v: false };
  const stream = {
    [Symbol.asyncIterator]() {
      let sent = 0;
      return {
        next: async () =>
          sent++ < CHUNKS
            ? { value: { choices: [{ delta: { content: 'and then ' } }] }, done: false }
            : { value: undefined, done: true },
        // ES IteratorClose — this is the abort signal.
        return: async () => {
          closed.v = true;
          return { value: undefined, done: true };
        },
      };
    },
  };
  const create = async (_req) => stream;
  const client = instrument({ chat: { completions: { create } } });
  return { client, closed };
}

reset();
const dir = mkdtempSync(join(tmpdir(), 'cendor-recipe-'));
const chain = join(dir, 'stream-break.jsonl');

const audit = new AuditLog('answer-bot', { riskTier: 'limited', path: chain });
const { client, closed } = runawayClient();
const received = [];
let raised = 0;
let reason = '';
try {
  await withBudget({ tokens: 20, onExceed: 'break' }, async () => {
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages: [],
      stream: true,
    });
    try {
      for await (const chunk of stream) received.push(chunk);
    } catch (err) {
      if (!(err instanceof BudgetExceeded)) throw err;
      raised++;
      reason = String(err.message);
    }
  });
} finally {
  audit.detach();
}
// An entry's `payload` is typed `PyValue` (the JSON union a chain can hold), so naming the two
// fields a budget_event carries is both the narrowing and the documentation.

const broken = audit.entries.filter(
  (e) => e.type === 'budget_event' && e.payload.action === 'broken',
);
const [ok, detail] = verify(chain);
const lastBreak = broken.at(-1);
assert.ok(lastBreak, "the break was never chained as a budget_event(action='broken')");
const cap = lastBreak.payload.cap_tokens;

console.log(`stream       : cut after ${received.length} of ${CHUNKS} chunks (partial text kept)`);
console.log(`provider     : underlying stream closed = ${closed.v}`);
console.log(`raised       : ${raised}x BudgetExceeded - ${reason.split('\n')[0]}`);
console.log(`chained      : budget_event(action='broken'), cap ${cap} tokens`);
console.log(`verify()     : ${ok} - ${detail}`);

assert.equal(raised, 1, 'exactly one BudgetExceeded should surface on the cut');
if (!(received.length > 0 && received.length < CHUNKS))
  throw new Error('the runaway stream was not cut mid-flight');
assert.equal(closed.v, true, 'the provider stream was left open after the cut');
assert.notEqual(broken.length, 0, "the cut was not chained as a budget_event(action='broken')");
assert.equal(ok, true, 'the break audit chain failed verify()');
