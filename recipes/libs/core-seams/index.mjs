/**
 * core-seams (JS) — the three hooks every other Cendor library is built on.
 *
 * @cendor/core is deliberately small: it normalizes provider calls onto one bus and exposes a handful
 * of seams. Every other library in the set is JUST A SUBSCRIBER to those seams — which is also why
 * you can build your own tool beside them without forking anything.
 *
 *   trace(id, fn)            group a unit of work. Every LLMCall and ToolCall inside carries
 *                            traceId=id, and (with OpenTelemetry configured) the calls become
 *                            children of one parent span instead of N unrelated roots.
 *                            ⚠️ In TypeScript `trace` takes a CALLBACK; Python's is a `with` block.
 *   addStreamObserver(fn)    fn(call, deltaText, deltaThinking) per chunk of every instrumented
 *                            stream. Core extracts the deltas, so an observer never parses a provider
 *                            shape. THROWING ABORTS THE STREAM — that is exactly how tokenguard's
 *                            onExceed:'break' breaker is implemented; core learns no budget words.
 *   tokens.register(fam, fn) override the token counter for a model family. Needed the day you serve
 *                            a model whose tokenizer nobody bundles.
 *
 * Offline: fake OpenAI-shaped clients, no key, no OpenTelemetry needed.
 * Run:  npm install && node index.mjs
 */
import {
  LLMCall,
  addStreamObserver,
  bus,
  currentTraceId,
  instrument,
  removeStreamObserver,
  tokens,
  trace,
} from '@cendor/core';

const MODEL = 'gpt-4o';
const HOUSE_MODEL = 'acme-llm-1'; // a model nobody bundles a tokenizer for

function fakeClient(streamChunks = 0) {
  return instrument({
    chat: {
      completions: {
        create: async (params) => {
          if (params.stream) {
            return {
              async *[Symbol.asyncIterator]() {
                for (let i = 0; i < streamChunks; i++) {
                  yield { choices: [{ delta: { content: `part ${i} ` } }] };
                }
              },
            };
          }
          return {
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 30, completion_tokens: 7 },
            model: params.model ?? MODEL,
          };
        },
      },
    },
  });
}

const calls = [];
const collect = (event) => {
  if (event instanceof LLMCall) calls.push(event);
};
bus.subscribe(collect);

// ---- seam 1: trace() groups a unit of work ------------------------------------------------------
const client = fakeClient();
let inside;
await trace('order-8812-refund', async () => {
  inside = currentTraceId();
  await client.chat.completions.create({ model: MODEL, messages: [{ role: 'user', content: 'a' }] });
  await client.chat.completions.create({ model: MODEL, messages: [{ role: 'user', content: 'b' }] });
});
await client.chat.completions.create({ model: MODEL, messages: [{ role: 'user', content: 'c' }] });

const grouped = calls.filter((c) => c.traceId === 'order-8812-refund');
console.log(`trace()          : currentTraceId() inside the scope = ${JSON.stringify(inside)}`);
console.log(`                   ${grouped.length} of ${calls.length} calls carry it; the one outside has traceId=${JSON.stringify(calls.at(-1).traceId)}`);

// ---- seam 2: a per-chunk stream observer ---------------------------------------------------------
const seen = [];
const meter = (call, deltaText) => {
  seen.push(deltaText);
};
addStreamObserver(meter);
let consumed = 0;
try {
  const stream = await fakeClient(12).chat.completions.create({ model: MODEL, messages: [], stream: true });
  for await (const _ of stream) consumed++;
} finally {
  removeStreamObserver(meter);
}
console.log(`stream observer  : ${seen.length} chunk deltas seen for ${consumed} chunks consumed, first delta ${JSON.stringify(seen[0])}`);
console.log("                   throwing inside the observer CLOSES the provider stream - that is how tokenguard's break works");

// ---- seam 3: a custom tokenizer for a model nobody bundles ---------------------------------------
const text = 'the quick brown fox jumps over the lazy dog';
const before = [tokens.count(text, HOUSE_MODEL), tokens.method(HOUSE_MODEL)];

// Our house model bills one token per two characters. Nothing else needs to know.
// NOTE: family() maps an id to a tokenizer family, and an id nobody recognises lands in "default" —
// so registering here also covers every other unrecognised model. Register a specific family
// ("openai", "anthropic") when that is what you mean.
tokens.register(tokens.family(HOUSE_MODEL), (t) => Math.max(1, Math.floor(String(t).length / 2)));
const after = [tokens.count(text, HOUSE_MODEL), tokens.method(HOUSE_MODEL)];

console.log(`tokens.register(): ${HOUSE_MODEL} family=${JSON.stringify(tokens.family(HOUSE_MODEL))}`);
console.log(`                   before ${before[0]} tokens (method ${JSON.stringify(before[1])}) -> after ${after[0]} tokens (method ${JSON.stringify(after[1])})`);
console.log('                   every budget, receipt and estimate downstream now uses your counter');

bus.unsubscribe(collect);

if (grouped.length !== 2 || calls.at(-1).traceId === 'order-8812-refund') throw new Error('trace() did not group');
if (seen.length !== 12) throw new Error('the stream observer did not see every chunk');
if (after[1] !== 'registered') throw new Error('tokens.method() should report the registered counter');
if (after[0] !== Math.floor(text.length / 2)) throw new Error('the custom counter was not used');
