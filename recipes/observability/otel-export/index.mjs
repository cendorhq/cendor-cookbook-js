/**
 * otel-export (JS) — stream governance to your OpenTelemetry backend, offline.
 *
 * Cendor emits standard `gen_ai.*` telemetry, so spend metrics and the audit trail flow to Azure
 * Monitor / CloudWatch / Datadog / any OTLP backend with **no Cendor-specific exporter**. This
 * recipe proves it with IN-MEMORY OTel readers — no account, no collector, no network:
 *
 *   1. `useSink(new OTelSink({ meter }))`      — spend rows become metric counters, dimensioned by
 *                                                `track()` tags.
 *   2. `new AuditLog(…, { mirror: new OTelMirror(tracer) })` — every chained audit entry also
 *                                                becomes an `audit.<type>` span.
 *   3. A pre-flight `budget({ onExceed: 'block' })` trips a `BudgetEvent`, which acttrace chains as
 *      a `budget_event` and the mirror exports as an `audit.budget_event` span — the ONE signal a
 *      *refused* call ever leaves.
 *
 * ⚠️ **Injected `tracer` / `meter`, not a global provider.** `otel.span(…, { tracer })`,
 * `new OTelSink({ meter })` and `new OTelMirror(tracer)` all take an explicit instrument. Reaching
 * for the global provider in a test makes an assertion that passes whether or not your code emitted
 * anything — there is always *a* provider, and a no-op one records nothing and complains about
 * nothing. In production you set the global once (one line from your vendor's distro) and change
 * nothing else here.
 *
 * The hash-chained FILE stays the sole verifiable evidence — `verify()` runs on it, never on the
 * mirror. A mirror is an operational copy; losing it must never invalidate the record.
 *
 * Offline. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuditLog, OTelMirror, verify } from '@cendor/acttrace';
import { instrument } from '@cendor/core';
import { BudgetExceeded, budget, report, reset, track, useSink } from '@cendor/tokenguard';
import { OTelSink } from '@cendor/tokenguard/sinks';
// ⚠️ There is no `InMemoryMetricReader` in the JS SDK — Python has one, JS does not. The equivalent
// is a `PeriodicExportingMetricReader` wrapping an `InMemoryMetricExporter`, and you force a
// collection with `await reader.forceFlush()` rather than reading the reader directly.
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';

const SIGNING_KEY = 'demo-signing-key';

/**
 * Stand in for your backend's distro. In production this is one call to your vendor
 * (`useAzureMonitor()`) or an OTLP exporter — and you would set the GLOBAL provider rather than
 * handing the instruments around. Here they are explicit so the assertions below can only pass if
 * something was really emitted.
 */
function configureOtel() {
  const spanExporter = new InMemorySpanExporter();
  const tracerProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000, // never fires on its own here — we forceFlush() instead
  });
  const meterProvider = new MeterProvider({ readers: [metricReader] });
  return {
    spanExporter,
    metricReader,
    metricExporter,
    tracer: tracerProvider.getTracer('cendor-recipe'),
    meter: meterProvider.getMeter('cendor-recipe'),
  };
}

/** An instrumented OpenAI-shaped client — real pricing/audit, no network, no key. */
function fakeClient() {
  return instrument({
    chat: {
      completions: {
        create: async () => ({ usage: { prompt_tokens: 1000, completion_tokens: 500 } }),
      },
    },
  });
}

async function tokenUsageTotal(metricReader, metricExporter) {
  await metricReader.forceFlush(); // push the current accumulation into the in-memory exporter
  let total = 0;
  for (const rm of metricExporter.getMetrics()) {
    for (const sm of rm.scopeMetrics ?? []) {
      for (const metric of sm.metrics) {
        if (metric.descriptor.name === 'gen_ai.client.token.usage') {
          for (const point of metric.dataPoints) total += Number(point.value);
        }
      }
    }
  }
  return total;
}

reset();
const { spanExporter, metricReader, metricExporter, tracer, meter } = configureOtel();
const client = fakeClient();

// (1) spend rows -> metric counters
useSink(new OTelSink({ meter }));

const chain = join(mkdtempSync(join(tmpdir(), 'cendor-otel-')), 'audit.jsonl');
// (2) every chained audit entry -> an `audit.<type>` span
const audit = new AuditLog('otel-demo', {
  riskTier: 'limited',
  path: chain,
  signingKey: SIGNING_KEY,
  mirror: new OTelMirror(tracer),
});

// (3) a pre-flight block, which is the one signal a REFUSED call ever leaves.
//
// ⚠️ `outputReserve` is what makes this pre-flight. Without it the projection only counts INPUT, so
// the cap is not crossed until settlement — and a post-flight overspend throws `BudgetExceeded`
// **without emitting a `BudgetEvent`**, because by then the call already happened and is already on
// the bus as an `LLMCall`. Measured while writing this recipe: same exception, same message shape,
// and NO `audit.budget_event` span. If you want the refusal signal, you have to be refused.
const capped = budget({ usd: 0.02, onExceed: 'block', outputReserve: 500 })(async () => {
  for (let i = 0; i < 10; i++) {
    await track({ feature: 'summarizer' }, () =>
      client.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    );
  }
});

let blocked = false;
try {
  await capped();
} catch (err) {
  if (!(err instanceof BudgetExceeded)) throw err;
  blocked = true;
} finally {
  useSink(null);
  audit.detach();
}

const spans = spanExporter.getFinishedSpans();
const spanNames = [...new Set(spans.map((s) => s.name))].sort();
const tokenTotal = await tokenUsageTotal(metricReader, metricExporter);
const ran = report().rows.reduce((n, r) => n + r.calls, 0);
const [ok, detail] = verify(chain, { key: SIGNING_KEY });

console.log(`calls that ran     : ${ran} (the next one was refused pre-flight: ${blocked})`);
console.log(`metric counter     : gen_ai.client.token.usage = ${tokenTotal} tokens`);
console.log(`spans exported     : ${spans.length}`);
console.log(`span names         : ${spanNames.join(', ')}`);
console.log(`verify(chain file) : ${ok} - ${detail}`);
console.log('\nthe FILE is the evidence; the spans are an operational copy of it.');

assert.equal(blocked, true, 'the budget never blocked — there is no refusal signal to export');
assert.ok(tokenTotal > 0, 'the OTelSink emitted no token metric at all');
assert.equal(
  tokenTotal,
  ran * 1500,
  `the metric should carry every settled call's tokens (${ran} × 1500), got ${tokenTotal}`,
);
assert.ok(spans.length > 0, 'the OTelMirror exported no spans');
// The refusal is the interesting one: a blocked call makes no provider request, so a `budget_event`
// span is the ONLY trace of it that ever reaches your backend.
assert.ok(
  spanNames.includes('audit.budget_event'),
  `no audit.budget_event span — a refused call left no trace. got: ${spanNames.join(', ')}`,
);
assert.equal(ok, true, 'the hash-chained file failed verify()');
