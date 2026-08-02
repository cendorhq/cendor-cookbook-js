/**
 * azure-foundry-otel (JS) — budget + audit calls your process never made.
 *
 * A managed runtime (e.g. the Agent Service in Microsoft Foundry, formerly Azure AI Foundry) owns the
 * agent loop server-side; your client never sees the calls. But it emits OpenTelemetry `gen_ai.*`
 * spans. Forward each span's attributes to `otel.ingest()` and the call lands on the same cendor bus
 * — so tokenguard budgets it and acttrace records it, exactly as if you'd made the call yourself.
 *
 * ⚠️ **There is no client to `instrument()` here, and that is the point.** `instrument()` wraps a
 * client you hold; in a managed runtime you hold nothing. `otel.ingest()` is the other adoption
 * point — telemetry in rather than a call intercepted. If you *do* hold the client, you want
 * `instrument()` and not this: see `frameworks/azure-foundry-otel-export`, which holds one and sends
 * governance the other way (spans OUT to your backend).
 *
 * Fully offline by nature (in-memory spans; no Azure account, no collector).
 * Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuditLog, verify } from '@cendor/acttrace';
import { otel } from '@cendor/core';
import { report, reset, track } from '@cendor/tokenguard';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';

const SIGNING_KEY = 'demo-signing-key';

// Three turns of a Foundry-hosted agent, as gen_ai.* span attributes (model, tokens, cache).
const FOUNDRY_TURNS = [
  { model: 'gpt-4o', in: 1200, out: 400, cached: 0 },
  { model: 'gpt-4o', in: 1500, out: 350, cached: 300 },
  { model: 'gpt-4o', in: 900, out: 220, cached: 0 },
];

/** Stand in for Foundry's telemetry: real OTel spans carrying gen_ai.* attributes. */
function emitFoundrySpans() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const tracer = provider.getTracer('azure-foundry-agent');
  for (const turn of FOUNDRY_TURNS) {
    const span = tracer.startSpan('chat gpt-4o');
    span.setAttribute('gen_ai.system', 'azure_ai_foundry');
    span.setAttribute('gen_ai.request.model', turn.model);
    span.setAttribute('gen_ai.usage.input_tokens', turn.in);
    span.setAttribute('gen_ai.usage.output_tokens', turn.out);
    span.setAttribute('gen_ai.usage.cached_tokens', turn.cached);
    span.end();
  }
  return exporter.getFinishedSpans();
}

reset();
const audit = new AuditLog('foundry_agent', { riskTier: 'limited', signingKey: SIGNING_KEY });
const spans = emitFoundrySpans();

await track({ feature: 'foundry_agent' }, () => {
  for (const span of spans) {
    // Forward the span -> a normalized LLMCall on the bus. `attributes` is already a plain object
    // here; Python's twin says `dict(span.attributes)` because its SDK hands back a mapping view.
    otel.ingest({ ...span.attributes });
  }
});
audit.detach();

const r = report(['feature']);
let calls = 0;
for (const row of r) calls += row.calls; // ReportRow keeps the snake_case wire keys
console.log(`ingested ${spans.length} Foundry gen_ai.* spans (calls this process never made)`);
console.log(`tokenguard: $${r.total().amount.toString()} across ${calls} calls`);

const evidence = join(mkdtempSync(join(tmpdir(), 'cendor-foundry-ingest-')), 'evidence.jsonl');
audit.export(evidence, 'eu_ai_act'); // framework is POSITIONAL in TypeScript, not an options object
const [ok] = verify(evidence, { key: SIGNING_KEY });
const entries = audit.entries.filter((e) => e.type === 'llm_call').length;
console.log(`acttrace  : ${entries} llm_call entries, verify: ${ok}`);

assert.equal(spans.length, FOUNDRY_TURNS.length, 'the stand-in runtime emitted the wrong span count');
// The whole claim of this recipe: a call the process never made is still budgeted and recorded.
assert.equal(calls, FOUNDRY_TURNS.length, `every ingested span must reach tokenguard, got ${calls}`);
assert.ok(r.total().amount.gt(0), 'gpt-4o is priced, so ingested usage must carry a cost');
assert.equal(entries, FOUNDRY_TURNS.length, `every ingested call must be chained, got ${entries}`);
assert.equal(ok, true, 'the exported evidence failed verify()');

console.log(
  '\n⚠️ `ingest()` trusts the runtime\'s numbers — it normalizes telemetry, it does not measure. ' +
    'A span with no usage attributes yields a call with `usage: null` and no cost, not a guess.\n' +
    '⚠️ A Foundry DEPLOYMENT name is unpriced. These spans report `gpt-4o`, a real model id; a span ' +
    'reporting `prod-gpt4o-eastus` needs `prices.registerDeployment(...)` first or its cost is null.',
);
