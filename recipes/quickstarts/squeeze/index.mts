/**
 * @cendor/squeeze quickstart (JS) — shrink a huge blob before it eats your context window.
 *
 * A verbose log dump is mostly repetition. squeeze compresses it toward a token target and hands
 * back a reversible handle, so you can send 400 tokens to the model and still restore the original
 * byte-for-byte when you need it.
 *
 * Offline: pure compression, no model call. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';

import { tokens } from '@cendor/core';
import { compress } from '@cendor/squeeze';

const MODEL = 'gpt-4o';

/** Repetitive application logs — the kind that balloon a prompt for no real signal. */
function noisyLogs(lines = 1500) {
  const out = [];
  for (let i = 0; i < lines; i++) {
    const mm = String(i % 60).padStart(2, '0');
    out.push(
      `2026-07-03T10:${mm}:${mm}Z INFO  worker-7 handled request id=req-${i} status=200 ` +
        'latency_ms=12 route=/v1/refunds user=svc-billing region=us-east-1 cache=hit retries=0',
    );
  }
  return out.join('\n');
}

const logs = noisyLogs();

const [small, handle] = compress(logs, { kind: 'auto', targetTokens: 400 });

const beforeKb = logs.length / 1024;
const afterKb = small.length / 1024;
const beforeTok = tokens.count(logs, MODEL);
const afterTok = tokens.count(small, MODEL);
const pct = 100 * (1 - small.length / logs.length);

const restored = handle.expand();
const identical = restored === logs;

console.log(`kind detected : ${handle.kind}  (technique: ${handle.technique})`);
console.log(`tokens        : ${beforeTok.toLocaleString('en-US')} -> ${afterTok.toLocaleString('en-US')}  (target 400)`);
console.log(
  `${beforeKb.toFixed(1)} KB -> ${afterKb.toFixed(1)} KB (${pct.toFixed(1)}% smaller) · ` +
    `expand(): byte-for-byte identical ${identical ? 'OK' : 'FAIL'}`,
);

assert.ok(identical, 'expand() must restore the original exactly');
assert.ok(afterTok <= 400, `compressed output must respect the token target, got ${afterTok}`);
// A compressor that returned its input unchanged would satisfy "identical" perfectly.
assert.ok(small.length < logs.length, 'nothing was actually compressed');
