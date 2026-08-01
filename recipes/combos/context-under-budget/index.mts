/**
 * context-under-budget (JS) — the budget binds on what actually SHIPS, not on what you typed.
 *
 * A 200-row JSON blob would blow the context window. contextkit assembles it to a token budget
 * (compressing the oversized block through squeeze), and the tokenguard clamp then binds on the
 * *assembled* prompt — so the receipt contextkit hands you and the input the provider bills are the
 * same number.
 *
 * Three libraries, zero imports between them: contextkit asks core's `Compressor` protocol for a
 * backend, squeeze satisfies it, tokenguard reads the same LLMCall off core's bus.
 *
 * Offline: a fake OpenAI-shaped client whose reported prompt_tokens is the REAL token count of
 * whatever it received. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';

import { instrument, tokens } from '@cendor/core';
import { type AssemblyReport, Block, Context, type Msg, useCompressor } from '@cendor/contextkit';
import { SqueezeCompressor } from '@cendor/squeeze';
import { clamps, estimate, reset, withBudget } from '@cendor/tokenguard';

const MODEL = 'gpt-4o';

/**
 * What the clamp path actually puts on the wire. `messages` is what contextkit assembled and
 * `max_completion_tokens` is the ceiling tokenguard injects — the two values this recipe measures.
 */
type SentRequest = {
  model?: string;
  messages?: Msg[];
  max_completion_tokens?: number;
};

/** A fake OpenAI client that bills exactly what it was sent — the honest scale. */
function countingClient(seen: SentRequest) {
  return instrument({
    chat: {
      completions: {
        create: async (params: SentRequest) => {
          Object.assign(seen, params);
          const n = tokens.count(params.messages ?? [], MODEL);
          return {
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: n, completion_tokens: 1 },
            model: params.model ?? MODEL,
          };
        },
      },
    },
  });
}

reset();
const row = { status: 'shipped', region: 'eu-west-1', total: 19.99 };
const payload = JSON.stringify({ rows: Array.from({ length: 200 }, (_, id) => ({ id, ...row })) });
const rawTokens = tokens.count(payload, MODEL);

const previous = useCompressor(new SqueezeCompressor()); // process-wide backend for evict:'compress'
let receipt: AssemblyReport | undefined;
let messages: Msg[] = [];
const seen: SentRequest = {};
try {
  const ctx = new Context({ budgetTokens: 220, model: MODEL, reserveOutput: 0 })
    .add(new Block('You are a precise data analyst.', { role: 'system', pin: true, priority: 100 }))
    .add(new Block(payload, { role: 'user', priority: 1, evict: 'compress' }));
  messages = await ctx.assemble();
  receipt = ctx.report();

  const compressed = receipt.decisions.filter((d) => d.action === 'compressed');
  assert.notEqual(compressed.length, 0, "evict:'compress' never fired");
  assert.ok(compressed[0].handle, 'the compressed block carried no handle, so it is not reversible');
  assert.equal(compressed[0].handle.expand(), payload, 'the eviction was not reversible');
  assert.equal(receipt.used, tokens.count(messages, MODEL), 'the receipt is not the real count');

  // Ship it under a clamp cap just above the input: input + the 256-token output reserve breaches
  // the cap, so the clamp injects a server-side output ceiling instead of raising.
  await withBudget({ tokens: receipt.used + 50, onExceed: 'clamp' }, async () => {
    await countingClient(seen).chat.completions.create({ model: MODEL, messages });
  });
} finally {
  useCompressor(previous);
}

assert.ok(receipt, 'the assembly never completed, so there is no receipt to compare against');
const cut = receipt.decisions.find((d) => d.action === 'compressed');
assert.ok(cut, "evict:'compress' never fired");
assert.ok(seen.messages, 'the clamped request never reached the fake provider');
const billed = tokens.count(seen.messages, MODEL);
const ceiling = seen.max_completion_tokens;
const assembled = estimate(MODEL, messages, 128).amount.toString();
const raw = estimate(MODEL, [{ role: 'user', content: payload }], 128).amount.toString();

console.log(`raw block        : ${rawTokens.toLocaleString('en-US')} tokens  (${(payload.length / 1024).toFixed(1)} KB of JSON)`);
console.log(`assembled        : ${receipt.used} tokens of a ${receipt.budget}-token budget`);
console.log(`eviction         : ${cut.action} (${cut.tokensBefore} -> ${cut.tokensAfter} tok), reversible`);
console.log(`billed input     : ${billed} tokens  == the receipt: ${billed === receipt.used}`);
console.log(`clamp injected   : max_completion_tokens=${ceiling}  (${clamps().length} clamp recorded)`);
console.log(`cost projection  : $${assembled} assembled vs $${raw} raw`);

assert.equal(billed, receipt.used, 'billed input drifted from the contextkit receipt');
assert.notEqual(ceiling, undefined, 'the clamp did not inject a server-side output ceiling');
if (!(Number(assembled) < Number(raw))) throw new Error('the projection did not bind on the assembled prompt');
