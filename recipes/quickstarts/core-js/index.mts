/**
 * @cendor/core quickstart (TypeScript) — one wrap, and every LLM call lands on a normalized event bus.
 *
 * Every cost/audit/testing tool wants to patch your client. @cendor/core patches it *once*:
 * instrument() wraps the client in place and emits a normalized LLMCall on a shared bus — provider,
 * model, usage, a Decimal cost with an honest pricing label, and the token-counting method it uses.
 *
 * Offline: a fake provider-shaped client, no key. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';

import { LLMCall, bus, instrument, tokens } from '@cendor/core';

// A stand-in for `new OpenAI()`. `instrument()` identifies a client by its SHAPE, never by class
// name and never by reaching for the network, so this plain object is recognised exactly like the
// real thing — which is what makes every recipe in this repo keyless.
function fakeOpenAI() {
  return {
    chat: {
      completions: {
        create: async (_req: { model: string; messages: { role: string; content: string }[] }) => ({
          usage: { prompt_tokens: 1200, completion_tokens: 350 },
        }),
      },
    },
  };
}

const client = instrument(fakeOpenAI());

const seen: LLMCall[] = [];
bus.subscribe((call) => {
  if (!(call instanceof LLMCall)) return;
  seen.push(call);
  const label = call.metadata.cost_reported ? 'cost_reported' : 'cost_estimated';
  console.log('LLMCall on the bus:');
  console.log(`  provider : ${call.provider}`);
  console.log(`  model    : ${call.model}`);
  // `usage` and `cost` are nullable on LLMCall, and the types say so: a call that reached the bus
  // before the provider reported usage has neither, and an *unpriced* model has usage but no cost
  // (that is the whole premise of the azure-foundry recipe). Narrow, never assume.
  if (call.usage) {
    console.log(`  usage    : ${call.usage.inputTokens} in + ${call.usage.outputTokens} out = ${call.usage.totalTokens} tokens`);
  }
  console.log(`  cost     : ${call.cost ? `$${call.cost.amount}` : 'unpriced'} (${label})`);
  console.log(`  tokens   : counted via '${tokens.method(call.model)}' for ${call.model}`);
});

await client.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] });

// The recipe IS the test — so it has to fail when the thing it claims stops being true. Printing
// alone would exit 0 just as happily if `instrument()` emitted nothing at all: the console would be
// empty, node would be pleased, and CI would be green.
const call = seen.at(-1);
assert.ok(seen.length === 1, `expected exactly one LLMCall on the bus, got ${seen.length}`);
assert.ok(call, 'no LLMCall reached the bus');
assert.equal(call.provider, 'openai', 'the provider was not inferred from the client shape');
assert.ok(call.usage, 'usage was not normalized');
assert.ok(call.usage.inputTokens > 0 && call.usage.outputTokens > 0, 'usage was not normalized');
assert.ok(call.cost, 'the call reached the bus unpriced');
assert.ok(call.cost.amount.gt(0), 'the call reached the bus unpriced');
// Money is decimal.js, never a float — `.toString()`, not `Number(...)`.
assert.equal(typeof call.cost.amount.toString(), 'string');
console.log('\nOK — one wrap, one normalized, priced event.');
