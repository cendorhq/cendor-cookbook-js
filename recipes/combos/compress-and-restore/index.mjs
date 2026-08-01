/**
 * compress-and-restore (JS) — an eviction you can audit AND undo.
 *
 * `evict: 'compress'` routes the block through core's `Compressor` PROTOCOL to whatever backend you
 * registered with useCompressor() — here @cendor/squeeze, which returns a reversible handle. squeeze
 * then emits a metadata-only CompressionEvent on core's bus, and an attached @cendor/acttrace chain
 * records it as a `compression` entry: technique, tokens before/after, handle id — and NEVER the
 * text. So the chain is safe to keep even when the content is not.
 *
 * Nothing imports anything: contextkit asks the protocol, squeeze satisfies it, acttrace duck-types
 * the event off the bus.
 *
 * Offline: pure compression, no model call. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, verify } from '@cendor/acttrace';
import { Block, Context, useCompressor } from '@cendor/contextkit';
import { tokens } from '@cendor/core';
import { SqueezeCompressor } from '@cendor/squeeze';
/**
 * What a `compression` audit entry actually holds. An entry's `payload` is typed `PyValue` — the
 * JSON union the chain can carry — so naming the fields here doubles as the documentation for what
 * squeeze puts in the chain. Note what is absent: there is no text field, and that is the point.
 */

const MODEL = 'gpt-4o';
const SECRET = 'case-notes: patient 55213, diagnosis withheld';

/** A long support transcript — the kind you must keep, but cannot afford to send. */
function transcript(turns = 60) {
  const lines = [`${SECRET}. Ticket opened by the duty nurse.`];
  for (let i = 0; i < turns; i++) {
    lines.push(
      `turn ${i}: agent asked for the order id; customer replied with order-${4000 + i}; ` +
        'agent confirmed the refund window is open and repeated the policy verbatim.',
    );
  }
  return lines.join('\n');
}

const content = transcript();
const dir = mkdtempSync(join(tmpdir(), 'cendor-recipe-'));
const chain = join(dir, 'compression-audit.jsonl');

const previous = useCompressor(new SqueezeCompressor());
const audit = new AuditLog('case-notes', { riskTier: 'high', path: chain });
let decision;
try {
  const ctx = new Context({ budgetTokens: 300, model: MODEL, reserveOutput: 0 })
    .add(new Block('Summarize the case.', { role: 'system', pin: true, priority: 100 }))
    .add(new Block(content, { role: 'user', priority: 1, evict: 'compress' }));
  await ctx.assemble();
  decision = ctx.report().decisions.find((d) => d.action === 'compressed');
} finally {
  audit.detach();
  useCompressor(previous);
}

const entry = audit.entries.find((e) => e.type === 'compression');
assert.ok(entry, 'squeeze emitted no CompressionEvent, so the chain has no `compression` entry');
assert.ok(decision, 'contextkit never took a `compressed` decision — nothing was evicted');
assert.ok(decision.handle, 'the compressed decision carried no handle, so it is not reversible');

const payload = entry.payload;

// ⚠️ Worth knowing in TypeScript, and invisible in JavaScript. `decision.handle` is core's PROTOCOL
// Handle — `{ expand(): unknown }`, deliberately the smallest thing contextkit needs to know — while
// `decompress()` from @cendor/squeeze declares its own concrete Handle class. At runtime this is one
// object and either call works; at compile time `decompress(decision.handle)` is an error, because
// the protocol type is narrower than the backend type by design. `.expand()` is the seam-pure call,
// and the seam is this recipe's whole point, so that is what it uses.
const restored = decision.handle.expand();
const leaked = Object.values(payload).some((v) => String(v).includes(SECRET));
const [ok, detail] = verify(chain);

console.log(`original         : ${tokens.count(content, MODEL).toLocaleString('en-US')} tokens`);
console.log(
  `after compress   : ${payload.tokens_after.toLocaleString('en-US')} tokens  (${payload.technique}, ratio ${payload.ratio.toFixed(3)})`,
);
console.log(`audit entry      : type=${entry.type} handle_id=${payload.handle_id.slice(0, 12)}…`);
console.log(`leaked content   : ${leaked}  (metadata only — the chain never holds the text)`);
console.log(`decompress()     : byte-for-byte identical ${restored === content}`);
console.log(`verify()         : ${ok} — ${detail}`);

assert.equal(restored, content, 'decompress() must restore the original exactly');
if (leaked) throw new Error('the audit entry leaked raw content');
if (!(payload.tokens_after < payload.tokens_before))
  throw new Error('nothing was actually compressed');
assert.equal(ok, true, 'the compression audit chain failed verify()');
