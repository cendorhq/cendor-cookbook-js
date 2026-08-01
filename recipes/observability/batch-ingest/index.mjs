/**
 * batch-ingest (JS) — account for a completed Batch API job's spend, offline.
 *
 * The OpenAI/Anthropic **Batch API** is server-side and returns results *hours* later, so pre-flight
 * governance (a budget breaker, a guardrail) is structurally impossible — there is nothing to
 * intercept at call time. Saying otherwise would be the dishonest version of this recipe.
 *
 * But the **accounting** is fully recoverable after the fact. Each result line carries its token
 * usage, and `otel.ingest(...)` turns those `gen_ai.*` numbers into a normalized `LLMCall` on the
 * same event bus a local call rides — so `tokenguard` prices and reports it, and an `OTelSink` or
 * `acttrace` mirror sees it, *exactly* as if it had been instrumented locally.
 *
 * Run each ingest under `track(...)` + `trace(batchId)` and the whole batch is attributed to a
 * feature and correlated as one run. Zero library change, no network, no key.
 *
 * Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';

import { otel, trace } from '@cendor/core';
import { report, reset, track } from '@cendor/tokenguard';

// A completed batch job's downloaded results (OpenAI Batch `output.jsonl` shape, trimmed to the
// fields that matter for accounting). In production these are the lines of the file the job returns.
const BATCH_OUTPUT_JSONL = [
  { custom_id: 'req-1', response: { body: { model: 'gpt-4o', usage: { prompt_tokens: 1200, completion_tokens: 300 } } } },
  { custom_id: 'req-2', response: { body: { model: 'gpt-4o', usage: { prompt_tokens: 800, completion_tokens: 150 } } } },
  { custom_id: 'req-3', response: { body: { model: 'gpt-4o', usage: { prompt_tokens: 2000, completion_tokens: 640 } } } },
]
  .map((line) => JSON.stringify(line))
  .join('\n');

/**
 * Attribute a completed batch's spend: one governed `LLMCall` per line (returns the count).
 *
 * Each line's usage becomes `gen_ai.*` attributes fed to `otel.ingest`, under `track()` (so the
 * spend is tagged with the feature + batch) and `trace(batchId)` (so all lines correlate as one run
 * — `ingest` stamps the ambient trace id onto the call). No pre-flight gate is possible here; this
 * is *post-hoc accounting*, which is exactly what the Batch API leaves room for.
 */
async function ingestBatch(outputJsonl, { batchId, feature }) {
  let count = 0;
  await trace(batchId, async () => {
    await track({ feature, batch_id: batchId }, async () => {
      for (const raw of outputJsonl.split('\n').filter(Boolean)) {
        const body = JSON.parse(raw).response.body;
        otel.ingest({
          'gen_ai.request.model': body.model,
          'gen_ai.usage.input_tokens': body.usage.prompt_tokens,
          'gen_ai.usage.output_tokens': body.usage.completion_tokens,
          'gen_ai.system': 'openai',
        });
        count++;
      }
    });
  });
  return count;
}

reset();
const BATCH_ID = 'batch_68f2c1a9';
const n = await ingestBatch(BATCH_OUTPUT_JSONL, { batchId: BATCH_ID, feature: 'nightly-summaries' });

const r = report(['feature', 'batch_id']);
console.log(`ingested   : ${n} result line(s) from ${BATCH_ID}`);
for (const row of r.rows) {
  console.log(`spend      : ${JSON.stringify(row.tags)}  ${row.calls} calls  ${row.tokens} tok  $${row.usd.amount.toString()}`);
}
console.log(`total      : $${r.total().amount.toString()}  — priced by the same table a live call uses`);

const expectedTokens = 1200 + 300 + 800 + 150 + 2000 + 640;
assert.equal(n, 3, `expected 3 result lines, ingested ${n}`);
assert.equal(r.rows.length, 1, 'the batch did not land under one feature/batch attribution');
assert.equal(r.rows[0].calls, 3, 'not every ingested line became a governed LLMCall');
assert.equal(
  r.rows[0].tokens,
  expectedTokens,
  `the ingested usage does not match the file (${expectedTokens}), got ${r.rows[0].tokens}`,
);
assert.ok(r.total().amount.gt(0), 'the ingested batch was not priced');
assert.equal(r.rows[0].tags.batch_id, BATCH_ID, 'the batch id did not ride the attribution tags');

console.log(
  '\n⚠️ This is ACCOUNTING, not governance. A Batch job runs server-side hours later, so there is ' +
    'nothing to intercept: no budget can refuse it, no guardrail can redact it. What you get back ' +
    'is a faithful, priced, attributable record — and pretending otherwise would be the one ' +
    'dishonest thing this recipe could do.',
);
