/**
 * contextkit-plug-a-compressor (JS) — swap the compression backend without touching a call site.
 *
 * contextkit does not know what squeeze is. When a block says `evict: 'compress'` it asks whatever
 * object matches core's `Compressor` PROTOCOL:
 *
 *     compress(content, { targetTokens, model }) -> [compressedText, handle]
 *
 * @cendor/squeeze is the default because it is deterministic and dependency-free. But your domain may
 * compress better than a general algorithm can. Register yours once with useCompressor() and every
 * `evict: 'compress'` block in the process uses it — no call site changes.
 *
 * This recipe plugs in a deliberately domain-specific compressor: keep only the lines that carry a
 * decision, and stash the original in a Map so the returned handle can expand() it back exactly.
 * That reversibility is the contract — contextkit surfaces the handle on the block's BlockDecision.
 *
 * Offline: pure assembly, no model call. Run:  npm install && node index.mjs
 */
import { createHash } from 'node:crypto';
import { Block, Context, useCompressor } from '@cendor/contextkit';
import { tokens } from '@cendor/core';
import { SqueezeCompressor } from '@cendor/squeeze';

const MODEL = 'gpt-4o';
const DECISION_WORDS = ['approved', 'refunded', 'escalated', 'denied'];

/**
 * A domain compressor: for a case log, only the decisions matter.
 *
 * Satisfies core's `Compressor` protocol by SHAPE — no base class, no import from contextkit. The
 * handle is any object with `expand()`; here a closure over a content-addressed Map, which is
 * exactly what squeeze does internally with its own store.
 */
class DecisionsOnly {
  #originals = new Map();

  compress(content) {
    const text = typeof content === 'string' ? content : String(content);
    const key = createHash('sha256').update(text).digest('hex');
    this.#originals.set(key, text);
    const kept = text.split('\n').filter((line) => DECISION_WORDS.some((w) => line.includes(w)));
    const small = kept.length > 0 ? kept.join('\n') : text.slice(0, 200);
    const originals = this.#originals;
    return [small, { id: key, technique: 'decisions-only', expand: () => originals.get(key) }];
  }
}

function caseLog(entries = 90) {
  const lines = [];
  for (let i = 0; i < entries; i++) {
    lines.push(`[${String(i).padStart(3, '0')}] agent viewed the order and read the policy aloud to the customer`);
    if (i % 15 === 0) {
      lines.push(`[${String(i).padStart(3, '0')}] DECISION: refunded order-${7000 + i} under the 30-day rule`);
    }
  }
  return lines.join('\n');
}

async function assembleWith(compressor, text) {
  const previous = useCompressor(compressor);
  try {
    const ctx = new Context({ budgetTokens: 260, model: MODEL, reserveOutput: 0 })
      .add(new Block('Summarize the decisions.', { role: 'system', pin: true, priority: 100 }))
      .add(new Block(text, { role: 'user', priority: 1, evict: 'compress' }));
    await ctx.assemble();
    return ctx.report().decisions.find((d) => d.action === 'compressed');
  } finally {
    useCompressor(previous);
  }
}

const log = caseLog();
const mine = await assembleWith(new DecisionsOnly(), log);
const theirs = await assembleWith(new SqueezeCompressor(), log);

console.log(`raw case log     : ${tokens.count(log, MODEL).toLocaleString('en-US')} tokens, ${log.split('\n').length} lines`);
console.log(`DecisionsOnly    : ${mine.tokensBefore} -> ${mine.tokensAfter} tok  (technique ${mine.handle.technique}, expand() exact: ${mine.handle.expand() === log})`);
console.log(`squeeze (default): ${theirs.tokensBefore} -> ${theirs.tokensAfter} tok  (technique ${theirs.handle.technique}, expand() exact: ${theirs.handle.expand() === log})`);
console.log('both satisfy the same protocol - contextkit imported neither, and no call site changed');
console.log('the handle is the contract: whatever you plug in must be able to give the original back');

if (mine.handle.expand() !== log) throw new Error("the custom compressor's handle was not reversible");
if (theirs.handle.expand() !== log) throw new Error('the squeeze handle was not reversible');
if (!(mine.tokensAfter < mine.tokensBefore)) throw new Error('the custom compressor did not compress');
