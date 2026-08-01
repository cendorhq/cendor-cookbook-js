/**
 * cassette-semantic-drift (JS) — drift() compares bytes; you usually want to compare meaning.
 *
 * Models do not produce bytes twice. So a scheduled rerecord against a live provider reports a
 * divergence on nearly every entry, most of them a harmless rewording — and a signal that is mostly
 * noise gets muted, which is the same as having no signal.
 *
 * semanticDrift(threshold, scorer) filters that list: it scores recorded-vs-live and keeps only the
 * divergences BELOW the threshold. The scorer is pluggable on purpose, and this recipe is mostly
 * about why it has to be.
 *
 * THE MEASURED RESULT, WHICH IS NOT THE INTUITIVE ONE. Both scorers available with no extra install
 * measure SURFACE similarity, and on the pair below they get it exactly backwards:
 *
 *   a harmless paraphrase             scores LOW  (few shared words)
 *   "30 days" changed to "14 days"    scores HIGH (one token differs)
 *
 * So a surface scorer keeps the noise and drops the thing you needed to see. That is not a bug in
 * lexicalScore — it is what lexical similarity IS, and it is the reason scorer= exists.
 *
 * ⚠️ PARITY NOTE — this is the one place the two ports genuinely differ. Python has
 * `local_embedding_scorer()` (model2vec static embeddings) as a real offline semantic backend behind
 * the `cendor-cassette[embeddings]` extra. **There is no maintained pure-JS model2vec**, so
 * `localEmbeddingScorer()` in @cendor/cassette exists only so the name is discoverable and THROWS by
 * design. The recipe calls it and prints the error rather than pretending otherwise. In JS you bring
 * your own embedder to `embeddingScorer(embedFn)`.
 *
 * Offline. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cassette from '@cendor/cassette';
import {
  embeddingScorer,
  lexicalScore,
  localEmbeddingScorer,
  semanticMatch,
} from '@cendor/cassette';
import { instrument } from '@cendor/core';

const MODEL = 'gpt-4o';
const ASK = [{ role: 'user', content: 'what is the refund window?' }];

const RECORDED = 'Refunds are available within 30 days of delivery.';
const REWORDED = 'You can request a refund up to 30 days after the item arrives.'; // same meaning
const CHANGED = 'Refunds are available within 14 days of delivery.'; // different meaning

function provider(answer) {
  return instrument({
    chat: {
      completions: {
        create: async (_req) => ({
          choices: [{ message: { content: answer } }],
          usage: { prompt_tokens: 24, completion_tokens: 12 },
          model: MODEL,
        }),
      },
    },
  });
}

/**
 * A hashed bag-of-words embedder — deterministic, offline, and DELIBERATELY crude. Here to show the
 * seam: embeddingScorer takes any `texts -> vectors` callable, so cassette binds no model and gains
 * no dependency. It is NOT a semantic model, and the output below says so.
 */
function toyEmbed(texts) {
  const dim = 96;
  return texts.map((text) => {
    const vec = new Array(dim).fill(0);
    for (const word of text.toLowerCase().replaceAll('.', ' ').split(/\s+/).filter(Boolean)) {
      const h = Number.parseInt(createHash('md5').update(word).digest('hex').slice(0, 12), 16);
      vec[h % dim] += 1;
    }
    const norm = Math.sqrt(vec.reduce((a, v) => a + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  });
}

const tape = join(mkdtempSync(join(tmpdir(), 'cendor-recipe-')), 'policy.json');
await cassette.using(tape, { mode: 'record' }, () =>
  provider(RECORDED).chat.completions.create({ model: MODEL, messages: ASK }),
);

const embed = embeddingScorer(toyEmbed);
const rows = [];
for (const [label, live] of [
  ['paraphrase', REWORDED],
  ['real change', CHANGED],
]) {
  await cassette.using(tape, { mode: 'rerecord' }, () =>
    provider(live).chat.completions.create({ model: MODEL, messages: ASK }),
  );
  rows.push({
    label,
    byteLevel: cassette.drift().length,
    lex: lexicalScore(live, RECORDED),
    lexKept: cassette.semanticDrift(0.8).length,
    emb: embed(live, RECORDED),
    embKept: cassette.semanticDrift(0.8, embed).length,
  });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`recorded    : ${JSON.stringify(RECORDED)}\n`);
console.log(
  `${pad('live answer', 12)} ${pad('drift()', 8)} ${pad('lexical', 8)} ${pad('kept', 5)} ${pad('toy-embed', 10)} kept`,
);
for (const r of rows) {
  console.log(
    `${pad(r.label, 12)} ${pad(r.byteLevel, 8)} ${pad(r.lex.toFixed(2), 8)} ${pad(r.lexKept, 5)} ${pad(r.emb.toFixed(2), 10)} ${r.embKept}`,
  );
}

console.log(
  "\nread the two 'kept' columns: the PARAPHRASE survives the filter and the REAL CHANGE is",
);
console.log(
  'dropped, under both scorers. A surface scorer measures shared words, so a rewrite looks',
);
console.log('like a big change and one edited number looks like none. That is the whole reason');
console.log('semanticDrift() takes scorer=.');

console.log('\nthe Python-only backend, shown rather than faked:');
try {
  localEmbeddingScorer();
  console.log('  localEmbeddingScorer() returned a scorer (unexpected in JS)');
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  localEmbeddingScorer() -> throws: ${msg.slice(0, 88)}`);
}
console.log(
  '  In Python that call IS the recommended offline semantic backend (model2vec, via the',
);
console.log(
  '  cendor-cassette[embeddings] extra). In JS, wrap your own model with embeddingScorer().',
);

console.log('\nwhere the lexical default IS the right tool - asserting an answer means roughly X:');
for (const expected of ['refund within 30 days', 'delivery']) {
  console.log(
    `  semanticMatch(recorded, ${JSON.stringify(expected)}) = ${semanticMatch(RECORDED, expected)}`,
  );
}

const negation = 'We will not offer a refund.';
console.log('\nhonest limit, measured rather than hidden:');
console.log(
  `  lexicalScore(${JSON.stringify(negation)}, 'offer a refund') = ${lexicalScore(negation, 'offer a refund').toFixed(2)} -> match ${semanticMatch(negation, 'offer a refund')}`,
);
console.log('  keyword containment cannot see a negation. Do not use it as a safety check.');

assert.ok(
  rows.every((r) => r.byteLevel === 1),
  'rerecord should report one byte-level divergence each time',
);
if (!(rows[0].lex < rows[1].lex))
  throw new Error('the measured inversion this recipe teaches has changed');
if (!semanticMatch(RECORDED, 'refund within 30 days'))
  throw new Error('the lexical default missed a match');
if (!semanticMatch(negation, 'offer a refund'))
  throw new Error('the documented negation limit changed');
