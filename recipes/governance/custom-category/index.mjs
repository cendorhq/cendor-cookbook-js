/**
 * custom-category (JS) — catch a request by *meaning*, not the exact words it used.
 *
 * A keyword denylist blocks `"write python code"` and sails straight past the paraphrase
 * `"create an app"` — same intent, different words. Literal matching cannot see meaning.
 *
 * `semantic.customCategory(name, examples, embed, opts)` defines a category by a few example
 * phrases and trips when a turn is close enough to any of them (recording `metadata.category` and
 * `metadata.score`) — the local, $0 counterpart to a hosted "rapid custom categories" feature
 * (examples → embedding search), with no cloud call and no training step.
 *
 * `embed(text)` is BRING-YOUR-OWN. **In production, pass the zero-config offline default**
 * `embeddings.localEmbedder()` (`npm i @huggingface/transformers`). To keep THIS recipe offline in
 * CI with no model download, it uses the tiny lexical bag-of-words `embed` defined below — enough
 * to show the mechanism and the compose-with-keywordDeny pattern. There is **no catch-rate claim**:
 * a similarity threshold is a heuristic — keep it `flag` until you calibrate on your own data.
 *
 * Offline: no model, no network. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';

import { bus } from '@cendor/core';
import { apply, rules, semantic } from '@cendor/guardrails';

const VOCAB = [
  'write',
  'create',
  'build',
  'make',
  'program',
  'app',
  'script',
  'code',
  'tool',
  'hello',
  'world',
];
const INDEX = new Map(VOCAB.map((w, i) => [w, i]));

/**
 * A tiny lexical bag-of-words vector (L2-normalized) — offline, dependency-free. NOT semantic: it
 * matches shared *words*, so it demos the API + composition. Swap for
 * `embeddings.localEmbedder()` for real (paraphrase) semantic matching.
 */
function embed(text) {
  const vec = new Array(VOCAB.length).fill(0);
  for (const tok of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const i = INDEX.get(tok);
    if (i !== undefined) vec[i] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  return norm ? vec.map((x) => x / norm) : vec;
}

bus._reset();

// A "code_requests" category defined by example — catches wordings a denylist would miss.
const category = semantic.customCategory(
  'code_requests',
  ['write a program', 'build an app', 'create a script'],
  embed,
  {
    threshold: 0.3, // tuned for the weak lexical stand-in; a real embedder wants ~0.6-0.8
    action: 'flag', // advisory until you calibrate the threshold on your data
    name: 'code_requests',
  },
);

const denylist = rules.keywordDeny(['write python code'], { action: 'flag', name: 'denylist' });

for (const turn of ['write python code for hello world', 'create a hello world app']) {
  const decs = apply([denylist, category], 'input', turn);
  const fired = new Set(decs.map((d) => d.guardrail));
  console.log(`\n${JSON.stringify(turn)}`);
  console.log(
    `  denylist fired: ${fired.has('denylist')}   customCategory fired: ${fired.has('code_requests')}`,
  );
  for (const d of decs) console.log(`    - ${d.guardrail} ${d.action}: ${d.reason}`);
}

// The denylist misses the paraphrase; the semantic category catches it — the whole point.
const para = apply([denylist, category], 'input', 'create a hello world app');
assert.deepEqual(
  para.map((d) => d.guardrail),
  ['code_requests'],
  'the paraphrase should fire ONLY the semantic category — if the denylist fired too, the demo proves nothing',
);
// A decision's `metadata` is an open record, so the recipe names the two fields it reads.
const paraMeta = para[0].metadata;
assert.equal(paraMeta.category, 'code_requests');
assert.ok(
  paraMeta.score > 0.3,
  'the recorded similarity score is below the threshold that fired it',
);

// ...and the literal phrasing must still fire BOTH, or "literal vs meaning" is not a contrast.
const literal = apply([denylist, category], 'input', 'write python code for hello world');
assert.deepEqual(
  literal.map((d) => d.guardrail).sort(),
  ['code_requests', 'denylist'],
  'the literal phrasing should fire both rails',
);

console.log(
  '\nkeywordDeny is literal; customCategory is by meaning. Pass embeddings.localEmbedder() ' +
    '(npm i @huggingface/transformers) for real paraphrase matching — the bag-of-words embed here ' +
    'is just an offline stand-in. No catch-rate claim; calibrate first.',
);
