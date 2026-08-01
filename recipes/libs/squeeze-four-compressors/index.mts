/**
 * squeeze-four-compressors (JS) — the same "compress this" means four different things.
 *
 * A JSON payload, a log dump, a source file and a page of prose fail in different ways, so squeeze
 * runs a different technique per kind and picks one by sniffing the content (kind: 'auto'):
 *
 *   json   minify + drop nulls        — whitespace and empty fields are pure overhead
 *   logs   normalize + dedup          — volatile fields blanked, then near-identical lines collapse
 *   code   strip comments/blank lines — structure is the signal, not the formatting
 *   prose  extractive                 — keep the sentences that carry the most new information
 *
 * `fidelity` chooses how hard to push: 'lossless', 'balanced', 'aggressive'. Every result is
 * reversible regardless — the original is kept in the content-addressed store and handle.expand()
 * returns it byte-for-byte.
 *
 * The ratios below are measured on this recipe's own inputs, not quoted from anywhere.
 *
 * Offline: pure compression, no model call. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';

import { tokens } from '@cendor/core';
import { compress, detect, type Kind } from '@cendor/squeeze';

const MODEL = 'gpt-4o';

const SAMPLES = {
  json: JSON.stringify(
    Array.from({ length: 120 }, (_, i) => ({
      id: i,
      sku: `SKU-${String(i).padStart(4, '0')}`,
      note: null,
      qty: i % 7,
      warehouse: 'eu-west-1',
    })),
    null,
    2,
  ),
  logs: Array.from({ length: 400 }, (_, i) => {
    const mm = String(i % 60).padStart(2, '0');
    return `2026-07-31T09:${mm}:${mm}Z INFO worker-3 handled req id=req-${i} status=200 latency_ms=${10 + (i % 4)} route=/v1/orders`;
  }).join('\n'),
  code: Array.from({ length: 12 }, () =>
    [
      '// The refund path. Historically this was three functions; it is one now.',
      '',
      'export function refund(orderId, amount) {',
      '  // Look the order up first - a refund against a missing order is a support ticket.',
      '  const order = orders.get(orderId);',
      '',
      '  if (order === undefined) throw new OrderNotFound(orderId);',
      '  // Partial refunds are allowed; over-refunds are not.',
      '  if (amount.greaterThan(order.total)) throw new TooMuch(amount, order.total);',
      '',
      '  return gateway.refund(order, amount);',
      '}',
    ].join('\n'),
  ).join('\n'),
  prose:
    'The refund policy is unchanged this quarter. Orders are refundable within thirty days of ' +
    'delivery, provided the item is returned in its original packaging. Digital goods are ' +
    'refundable only if unopened. The thirty-day window starts at delivery, not at purchase. ' +
    'Support agents may extend the window by seven days at their discretion. '.repeat(1),
};
SAMPLES.prose = SAMPLES.prose.repeat(25);

const pad = (s: unknown, n: number) => String(s).padEnd(n);
console.log(`${pad('kind', 7)} ${pad('detect()', 8)} ${pad('fidelity', 10)} ${pad('tokens', 18)} ${pad('ratio', 7)} technique`);
const results = [];
// `Object.entries` widens the key back to `string`; squeeze narrows `kind` to a literal union,
// so the cast restores what the object literal already knew.
for (const [kind, content] of Object.entries(SAMPLES) as [Kind, string][]) {
  // `as const` matters: squeeze narrows `kind`/`fidelity` to string-literal unions on purpose, so a
  // bare string[] is rejected. That narrowing is the Type Teach guardrail doing its job.
  for (const fidelity of ['lossless', 'balanced', 'aggressive'] as const) {
    const [small, handle] = compress(content, { kind, fidelity, model: MODEL });
    const before = tokens.count(content, MODEL);
    const after = tokens.count(small, MODEL);
    const exact = handle.expand() === content;
    results.push({ before, after, exact });
    const nums = `${before.toLocaleString('en-US').padStart(6)} -> ${after.toLocaleString('en-US').padStart(6)}`;
    const ratio = `${((100 * after) / before).toFixed(1)}%`.padStart(6);
    console.log(`${pad(kind, 7)} ${pad(detect(content), 8)} ${pad(fidelity, 10)} ${nums}  ${ratio}   ${handle.technique}`);
  }
}

const [auto, autoHandle] = compress(SAMPLES.logs, { kind: 'auto', targetTokens: 400, model: MODEL });
console.log(`\nauto    detected ${detect(SAMPLES.logs)}, target 400 -> ${tokens.count(auto, MODEL)} tokens (${autoHandle.technique})`);
console.log('every row above is reversible: handle.expand() returned the original byte-for-byte');

if (!results.every((r) => r.exact)) throw new Error('a compression was not reversible');
if (!results.every((r) => r.after <= r.before)) throw new Error("a 'compression' grew the input");
assert.equal(autoHandle.expand(), SAMPLES.logs, 'the auto-detected compression was not reversible');
if (detect(SAMPLES.json) !== 'json' || detect(SAMPLES.logs) !== 'logs') throw new Error('detect() missed');
