/**
 * intent-gate (JS) — decide whether a request should reach the model at all.
 *
 * Not every turn deserves a model call. A support bot asked to write poetry, a request for a topic
 * you do not serve — you want to catch that *before* you spend a token, and neither a keyword
 * denylist (too literal) nor a content classifier (wrong question) answers "is this on-task?".
 *
 * `intent.intent(labels, opts)` takes a BYO backend — a classifier, an embedder, or a small-LLM
 * judge — and runs in `allow` mode (flag anything NOT in these labels) or `deny` mode (refuse these
 * labels outright).
 *
 * Offline: a tiny deterministic keyword classifier. No model, no network.
 * Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';

import { bus } from '@cendor/core';
import { GuardrailTripped, apply, intent } from '@cendor/guardrails';

// A tiny, deterministic intent classifier — realistic enough to demo, honest that it is a stand-in.
// Swap in a trained CLU-style model, an ONNX head, or the embedding backend for production.
const KEYWORDS = {
  support: ['password', 'login', 'reset', 'account', 'error', 'bug'],
  billing: ['invoice', 'refund', 'charge', 'card', 'subscription', 'price'],
};

/** Return a { label: score } map — the fraction of a label's keywords present in the text. */
function classify(text) {
  const low = text.toLowerCase();
  return Object.fromEntries(
    Object.entries(KEYWORDS).map(([label, kws]) => [
      label,
      kws.filter((k) => low.includes(k)).length / kws.length,
    ]),
  );
}

bus._reset();

// allow-mode off-topic gate: flag anything that is not support or billing.
const gate = intent.intent(['support', 'billing'], {
  classify,
  mode: 'allow',
  threshold: 0.15,
  action: 'flag', // advisory — surface off-topic, don't hard-block until calibrated
});

const onTopic = "I can't reset my password, the login page shows an error";
const offTopic = 'Write me a poem about the ocean';

console.log('=== on-topic (support) — passes ===');
const onDecs = apply([gate], 'input', onTopic);
console.log(`  ${JSON.stringify(onTopic)} -> ${onDecs.length} decision(s)`);

console.log('\n=== off-topic — flagged before the model runs ===');
const offDecs = apply([gate], 'input', offTopic);
for (const d of offDecs) {
  console.log(`  ${d.guardrail} ${d.action}: ${d.reason}  metadata=${JSON.stringify(d.metadata)}`);
}

assert.equal(onDecs.length, 0, 'an on-topic support request was flagged — the gate is too tight');
assert.equal(offDecs.length, 1, 'the off-topic request was not flagged at all');
assert.equal(offDecs[0].action, 'flag');
assert.ok(offDecs[0].metadata.intent, 'the decision did not record which intent it saw');

// deny-mode + block: refuse a topic outright (here, "billing" is off-limits for this bot).
const deny = intent.intent(['billing'], { classify, mode: 'deny', threshold: 0.15, action: 'block' });
let blocked = null;
try {
  apply([deny], 'input', 'I want a refund on my last charge');
} catch (err) {
  if (!(err instanceof GuardrailTripped)) throw err;
  blocked = err;
  console.log(`\n=== deny-mode block === ${err.decisions.at(-1).reason}`);
}
assert.notEqual(blocked, null, 'deny mode did not block an in-denylist topic');

// ...and deny mode must NOT block a topic outside its list, or it is just a universal blocker.
assert.equal(
  apply([deny], 'input', 'my login page shows an error').length,
  0,
  'deny mode blocked a topic that is not in its deny list',
);

// The other two backends (not run here — they need an embedder / a model):
//   embedding exemplars (offline once you pass a local embedder):
//     const embed = await embeddings.localEmbedder();   // npm i @huggingface/transformers
//     intent.intent({ support: ['reset my password'] }, { embed, mode: 'allow' });
//   small-LLM judge (its own spend budgeted + audited through your instrumented client):
//     const policy = judge.intentPrompt(['support', 'billing'], { mode: 'allow' });
//     rules.llmJudge(judge.judge(respond, policy), { stage: 'input', action: 'flag' });
console.log('\nintent screening is a heuristic — no accuracy claim; calibrate + prefer flag');
