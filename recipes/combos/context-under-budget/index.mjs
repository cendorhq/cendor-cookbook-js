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
import { instrument, tokens } from '@cendor/core';
import { Block, Context, useCompressor } from '@cendor/contextkit';
import { SqueezeCompressor } from '@cendor/squeeze';
import { clamps, estimate, reset, withBudget } from '@cendor/tokenguard';

const MODEL = 'gpt-4o';

/** A fake OpenAI client that bills exactly what it was sent — the honest scale. */
function countingClient(seen) {
  return instrument({
    chat: {
      completions: {
        create: async (params) => {
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
let receipt;
let messages;
const seen = {};
try {
  const ctx = new Context({ budgetTokens: 220, model: MODEL, reserveOutput: 0 })
    .add(new Block('You are a precise data analyst.', { role: 'system', pin: true, priority: 100 }))
    .add(new Block(payload, { role: 'user', priority: 1, evict: 'compress' }));
  messages = await ctx.assemble();
  receipt = ctx.report();

  const compressed = receipt.decisions.filter((d) => d.action === 'compressed');
  if (compressed.length === 0) throw new Error("evict:'compress' never fired");
  if (compressed[0].handle.expand() !== payload) throw new Error('the eviction was not reversible');
  if (receipt.used !== tokens.count(messages, MODEL)) throw new Error('the receipt is not the real count');

  // Ship it under a clamp cap just above the input: input + the 256-token output reserve breaches
  // the cap, so the clamp injects a server-side output ceiling instead of raising.
  await withBudget({ tokens: receipt.used + 50, onExceed: 'clamp' }, async () => {
    await countingClient(seen).chat.completions.create({ model: MODEL, messages });
  });
} finally {
  useCompressor(previous);
}

const cut = receipt.decisions.find((d) => d.action === 'compressed');
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

if (billed !== receipt.used) throw new Error('billed input drifted from the contextkit receipt');
if (ceiling === undefined) throw new Error('the clamp did not inject a server-side output ceiling');
if (!(Number(assembled) < Number(raw))) throw new Error('the projection did not bind on the assembled prompt');
