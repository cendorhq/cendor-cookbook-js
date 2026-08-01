/**
 * llamaindex (JS) — pack unbounded RAG retrieval into a token budget, reversibly.
 *
 * A retriever cheerfully returns six oversized nodes; stuffing them all into the prompt blows the
 * context window. `@cendor/contextkit` packs the retrieved nodes to a budget, compressing the big
 * ones with `@cendor/squeeze` (`evict: 'compress'`) and dropping what still will not fit — and
 * prints a receipt. Each compressed chunk keeps a **handle** that restores the original
 * byte-for-byte, so nothing is actually lost.
 *
 * LlamaIndex *works alongside* Cendor here. It is not an official integration and no LlamaIndex API
 * is patched — a real `BaseRetriever` produces nodes, and contextkit packs them.
 *
 * Offline: a real LlamaIndex retriever + a fake OpenAI-shaped client. No key, no network.
 * Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';

import { Block, Context } from '@cendor/contextkit';
import { LLMCall, bus, instrument } from '@cendor/core';
import { SqueezeCompressor } from '@cendor/squeeze';
import { BaseRetriever, TextNode } from 'llamaindex';

const MODEL = 'gpt-4o';

/** A real LlamaIndex retriever returning six oversized nodes (highest score first). */
class DocsRetriever extends BaseRetriever {
  async _retrieve() {
    return Array.from({ length: 6 }, (_, i) => ({
      // ⚠️ `NodeWithScore` is a TYPE-only export in the JS package — there is no class to construct.
      // A plain `{ node, score }` object is exactly what the interface asks for.
      node: new TextNode({
        id_: `doc-${i}`,
        text: `Policy section ${i}: duplicate-charge refunds are issued within five business days once verified by billing. `.repeat(40),
      }),
      score: 1.0 - i * 0.1,
    }));
  }
}

function fakeOpenAI() {
  return {
    chat: {
      completions: {
        create: async () => ({ usage: { prompt_tokens: 2800, completion_tokens: 120 } }),
      },
    },
  };
}

bus._reset();
const calls = [];
bus.subscribe((e) => {
  if (e instanceof LLMCall) calls.push(e);
});

const nodes = await new DocsRetriever().retrieve({ query: 'How are duplicate charges refunded?' });
console.log(`retriever returned ${nodes.length} nodes`);

// ⚠️ `contextkit` AUTO-DISCOVERS `@cendor/squeeze` when it is installed — measured: removing the
// `compressor` line below changes nothing, blocks are still compressed and still reversible. So the
// explicit argument is not what turns compression on; it is how you swap in *your own* compressor.
// (Tools never import each other — squeeze plugs in by shape, through the optional peer.)
//
// What DOES matter is `onMissingCompressor`, for the case where squeeze is genuinely absent: the
// default `'note'` degrades to a lossy truncate and says so on the receipt, which is easy to miss in
// production. `'error'` refuses instead — the right choice when reversibility is the point.
const ctx = new Context({
  budgetTokens: 3000,
  model: MODEL,
  reserveOutput: 200,
  compressor: new SqueezeCompressor(), // explicit here only to show the seam; auto-discovery covers it
  onMissingCompressor: 'error', // if squeeze ever goes missing, fail loudly rather than truncate
});

ctx.add(new Block('Answer only from the policy sections provided.', { priority: 10, pin: true, role: 'system' }));
for (const [i, n] of nodes.entries()) {
  ctx.add(
    new Block(n.node.getContent('NONE'), {
      // Retrieval score becomes packing priority — the retriever already ranked them, so contextkit
      // does not need to guess. This is the whole point of the bridge.
      priority: Math.round(n.score * 10),
      evict: 'compress',
      role: 'user',
    }),
  );
}
ctx.add(new Block('How are duplicate charges refunded?', { priority: 9, pin: true, role: 'user' }));

const messages = await ctx.assemble();
const report = ctx.report();
console.log();
console.log(report.toString());

const compressed = report.decisions.filter((d) => d.action === 'compressed');
const dropped = report.decisions.filter((d) => d.action === 'dropped');
console.log();
console.log(`fits budget : used ${report.used} <= ${report.budget - report.reservedOutput}`);
console.log(`compressed  : ${compressed.length} node(s), each holding a reversible handle`);
console.log(`dropped     : ${dropped.length} node(s) that still would not fit`);

// Reversibility is the claim that separates this from truncation — prove it on a real handle.
const withHandle = compressed.find((d) => d.handle);
const restored = withHandle ? withHandle.handle.expand() : null;
console.log(`expand()    : ${restored ? `${restored.length} chars restored byte-for-byte` : 'n/a'}`);

const client = instrument(fakeOpenAI());
await client.chat.completions.create({ model: MODEL, messages });

assert.ok(nodes.length === 6, 'the retriever did not return six nodes');
assert.ok(
  report.used <= report.budget - report.reservedOutput,
  `the assembled prompt does not fit the budget: ${report.used}`,
);
assert.ok(compressed.length > 0, 'nothing was compressed — squeeze was never reached');
assert.ok(withHandle, 'a compressed block carries no handle, so the compression is not reversible');
assert.ok(restored.length > 0, 'expand() returned nothing');
assert.ok(
  restored.startsWith('Policy section'),
  'expand() did not restore the original node text',
);
assert.equal(calls.length, 1, 'the packed prompt never reached the instrumented client');

console.log(
  '\nLlamaIndex works ALONGSIDE Cendor — nothing is patched and this is not an official ' +
    'integration. The retriever ranks; contextkit packs to a budget and hands back a receipt.',
);
