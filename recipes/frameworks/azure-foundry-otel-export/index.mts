/**
 * azure-foundry-otel-export (JS) — Microsoft Foundry governance, exported as OpenTelemetry spans.
 *
 * The EXPORT direction: you hold the client, you `instrument()` it, and governance goes OUT to your
 * backend as ordinary spans. Its twin `frameworks/azure-foundry-otel` is the INGEST direction — a
 * managed runtime owns the loop, you hold nothing, and its `gen_ai.*` spans come IN via
 * `otel.ingest()`. Two folders because they are two subjects; a shared name would make one of them
 * a lie in whichever language you opened second.
 *
 * This is the two halves of the Foundry story in one file:
 *
 *   1. the **v1 GA endpoint** with the standard `openai` client — no `AzureOpenAI` class, no
 *      `api-version`, and no `azure-ai-inference` (which `instrument()` captures NOTHING from);
 *   2. a deployment name is **unpriced**, so `prices.registerDeployment(...)` is what makes a USD
 *      budget able to bind at all;
 *
 * ...and then every governance event lands in your existing OTel backend as a standard span. Azure
 * Monitor is one `useAzureMonitor()` call in production; here it is an in-memory exporter so the
 * recipe stays offline and its assertions can only pass if something was really emitted.
 *
 * ⚠️ **Injected tracer, not a global provider.** `new OTelMirror(tracer)` takes the instrument
 * explicitly. Asserting against the global provider is an assertion that passes whether or not your
 * code emitted anything — there is always *a* provider, and a no-op one records nothing.
 *
 * Offline: a fake OpenAI-shaped client + in-memory OTel. No key, no network.
 * Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuditLog, OTelMirror, verify } from '@cendor/acttrace';
import { LLMCall, bus, instrument, prices } from '@cendor/core';
import { BudgetExceeded, budget, reset } from '@cendor/tokenguard';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';

const SIGNING_KEY = 'demo-signing-key';
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT ?? 'prod-gpt4o-eastus';
const BASE_MODEL = process.env.AZURE_BASE_MODEL ?? 'gpt-4o';
const IN_TOKENS = 11_000;
const OUT_TOKENS = 1_500;
// ⚠️ A REAL prompt, not a one-word stub. The pre-flight projection counts the tokens actually in
// `messages`; the fake's reported `usage` only governs what SETTLES. With a one-character prompt the
// projection is ~nothing, the cap is never crossed before the call, and what you get is a
// POST-flight overspend — which throws the same `BudgetExceeded` but emits NO `BudgetEvent`, so the
// refusal never reaches your telemetry backend. Measured while writing this recipe.
const CLAIM = "The claimant's policy history plus the adjuster's notes and the repair estimate. ".repeat(1000);

/** Stand-in for the v1 GA client. Foundry echoes the DEPLOYMENT name back, not a model id. */
function fakeFoundry() {
  return {
    chat: {
      completions: {
        create: async (_req: { model: string; messages: { role: string; content: string }[] }) => ({
          choices: [{ message: { content: 'Approved.' } }],
          usage: { prompt_tokens: IN_TOKENS, completion_tokens: OUT_TOKENS },
          model: DEPLOYMENT,
        }),
      },
    },
  };
}

// In production this whole block is one line from your vendor's distro:
//   import { useAzureMonitor } from '@azure/monitor-opentelemetry';
//   useAzureMonitor();                      // sets the GLOBAL provider; change nothing else below
const spanExporter = new InMemorySpanExporter();
const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(spanExporter)],
});
const tracer = tracerProvider.getTracer('cendor-recipe');

reset();
bus._reset();
const calls = [];
bus.subscribe((e) => {
  if (e instanceof LLMCall) calls.push(e);
});

const client = instrument(fakeFoundry());
const ask = (text: string) =>
  client.chat.completions.create({ model: DEPLOYMENT, messages: [{ role: 'user', content: text }] });

// (2) make the deployment priceable, or the USD budget below is a silent no-op.
prices.registerDeployment(DEPLOYMENT, { like: BASE_MODEL });
const unit = prices.estimate(DEPLOYMENT, IN_TOKENS, { outputTokens: OUT_TOKENS });
console.log(`deployment : ${DEPLOYMENT} -> priced like ${BASE_MODEL} ($${unit.amount.toString()}/call)`);

const chain = join(mkdtempSync(join(tmpdir(), 'cendor-foundry-otel-')), 'audit.jsonl');
const audit = new AuditLog('foundry-triage', {
  riskTier: 'high',
  path: chain,
  signingKey: SIGNING_KEY,
  mirror: new OTelMirror(tracer),
});

// `outputReserve` is what makes the block PRE-flight. Without it the projection counts input only,
// the cap is crossed at settlement instead, and a post-flight overspend emits no BudgetEvent — so
// the refusal would never reach your backend at all.
const capped = budget({
  usd: 0.06,
  onExceed: 'block',
  outputReserve: OUT_TOKENS,
  name: 'foundry-triage cap', // a BOUNDED identifier — it becomes a metric attribute
})(async () => {
  for (let i = 0; i < 8; i++) await ask(CLAIM);
});

let blocked = false;
try {
  await capped();
} catch (err) {
  if (!(err instanceof BudgetExceeded)) throw err;
  blocked = true;
} finally {
  audit.detach();
}

const spans = spanExporter.getFinishedSpans();
const spanNames = [...new Set(spans.map((s) => s.name))].sort();
const budgetSpan = spans.find((s) => s.name === 'audit.budget_event');
const [ok, detail] = verify(chain, { key: SIGNING_KEY });

console.log(`calls that ran : ${calls.length} (the next was refused pre-flight: ${blocked})`);
console.log(`spans exported : ${spans.length} — ${spanNames.join(', ')}`);
console.log(`refusal span   : ${budgetSpan ? budgetSpan.name : 'MISSING'}`);
console.log(`verify(file)   : ${ok} - ${detail}`);
console.log('\nAzure Monitor sees these as ordinary spans. Nothing Cendor-specific is exported.');

assert.ok(unit.amount.gt(0), 'registerDeployment() did not make the deployment priceable');
assert.equal(blocked, true, 'the USD cap never bound — the deployment is still effectively unpriced');
assert.ok(calls.length > 0 && calls.length < 8, `the cap should bind mid-loop, got ${calls.length}`);
assert.ok(spans.length > 0, 'the OTelMirror exported no spans at all');
// The refusal is the whole point of exporting governance: a blocked call makes no provider request,
// so this span is the ONLY trace of it that ever reaches your backend.
assert.ok(budgetSpan, `no audit.budget_event span — a refused call left no trace. got: ${spanNames.join(', ')}`);
assert.equal(ok, true, 'the hash-chained file failed verify()');

console.log(
  '\n⚠️ The FILE is the evidence; the spans are an operational copy. `verify()` runs on the file and ' +
    'never on the mirror — losing your telemetry backend must not invalidate the record.\n' +
    '⚠️ A `model-router` deployment is NOT priceable: it bills at the serving model\'s rates while ' +
    'reporting the router\'s own id, so no single registration is ever correct.',
);
