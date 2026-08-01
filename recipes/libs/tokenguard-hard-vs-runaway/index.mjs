/**
 * tokenguard-hard-vs-runaway (JS) — `clamp` and `break` guard two different failures.
 *
 *   clamp  — a HARD CAP, enforced by the PROVIDER. Before the call goes out, tokenguard injects the
 *            provider's own output-limit kwarg (max_completion_tokens, or the nested equivalent on
 *            Bedrock/Gemini/Ollama). The response physically cannot exceed it. The call still happens.
 *   break  — a RUNAWAY GUARD, enforced by YOU, mid-flight. It only bites on a STREAM: a per-chunk
 *            observer closes the provider stream once the running output estimate crosses the cap.
 *            On a non-streamed call there is no mid-flight, so it can only notice afterwards.
 *
 * Rule of thumb: clamp when you know the answer should be short. break when you don't know how long
 * it will be and want a stop button. block when the call must not happen at all.
 *
 * Offline: fake OpenAI-shaped clients, no key. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';

import { instrument } from '@cendor/core';
import { BudgetExceeded, clamps, reset, withBudget } from '@cendor/tokenguard';

const MODEL = 'gpt-4o';
const PROMPT = [{ role: 'user', content: 'explain the refund policy' }];
/** What reaches the provider. `max_completion_tokens` is the ceiling a `clamp` injects. */

/** A normal (non-streaming) fake provider that records the kwargs it was handed. */
function blockingClient(seen) {
  return instrument({
    chat: {
      completions: {
        create: async (params) => {
          for (const k of Object.keys(seen)) delete seen[k];
          Object.assign(seen, params);
          return {
            choices: [{ message: { content: 'short answer' } }],
            usage: { prompt_tokens: 40, completion_tokens: 900 },
            model: MODEL,
          };
        },
      },
    },
  });
}

/** A stream whose `return()` (ES IteratorClose) is the abort signal a real SDK stream uses. */
function streamingClient(chunks = 80) {
  const closed = { v: false };
  const stream = {
    [Symbol.asyncIterator]() {
      let sent = 0;
      return {
        next: async () =>
          sent++ < chunks
            ? { value: { choices: [{ delta: { content: 'on and on ' } }] }, done: false }
            : { value: undefined, done: true },
        return: async () => {
          closed.v = true;
          return { value: undefined, done: true };
        },
      };
    },
  };
  const create = async (_req) => stream;
  return { client: instrument({ chat: { completions: { create } } }), closed };
}

// ---- clamp: the provider is told the ceiling, so the answer cannot be long ----------------------
reset();
const seen = {};
await withBudget({ tokens: 200, onExceed: 'clamp' }, () =>
  blockingClient(seen).chat.completions.create({ model: MODEL, messages: PROMPT }),
);
const ceiling = seen.max_completion_tokens;
console.log(
  `clamp  (non-stream) : injected max_completion_tokens=${ceiling} -> ${clamps().length} clamp, no exception, the call ran`,
);

// ---- break: the stream is cut mid-flight, and the socket is closed ------------------------------
reset();
const { client, closed } = streamingClient();
let got = 0;
let cut = null;
await withBudget({ tokens: 25, onExceed: 'break' }, async () => {
  const stream = await client.chat.completions.create({
    model: MODEL,
    messages: PROMPT,
    stream: true,
  });
  try {
    for await (const _ of stream) got++;
  } catch (err) {
    if (!(err instanceof BudgetExceeded)) throw err;
    cut = err;
  }
});
console.log(`break  (stream)     : cut after ${got}/80 chunks, provider stream closed=${closed.v}`);

// ---- break on a NON-stream: nothing to cut, so it can only notice afterwards ---------------------
reset();
let after = null;
try {
  await withBudget({ tokens: 25, onExceed: 'break' }, () =>
    blockingClient({}).chat.completions.create({ model: MODEL, messages: PROMPT }),
  );
} catch (err) {
  if (!(err instanceof BudgetExceeded)) throw err;
  after = String(err.message);
}
console.log(
  `break  (non-stream) : ${after ? 'threw POST-flight' : 'no effect'} - the money is already spent`,
);
console.log(`                      ${after ? after.split('\n')[0].slice(0, 96) : ''}`);
console.log(
  'choose              : clamp when the answer should be short (provider enforces it); break when length is unknown and you want a stop button',
);

assert.notEqual(ceiling, undefined, 'clamp did not inject a server-side ceiling');
if (cut === null || got === 0 || got >= 80)
  throw new Error('break did not cut the stream mid-flight');
assert.equal(closed.v, true, 'break left the provider stream open');
assert.notEqual(after, null, 'break on a non-streamed call should still surface a breach');
