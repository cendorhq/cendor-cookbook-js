# otel-export (JS) — spend metrics and governance spans, with no Cendor-specific exporter

**The pain.** Every observability vendor wants its own SDK. You already ship OpenTelemetry, and you
do not want a second pipeline just to see what your agents cost.

**What this shows.** Cendor emits standard `gen_ai.*` telemetry, so it flows to Azure Monitor /
CloudWatch / Datadog / any OTLP backend through the pipeline you already have.

| # | wiring | what appears |
|---|---|---|
| 1 | `useSink(new OTelSink({ meter }))` | spend rows become metric counters, dimensioned by `track()` tags |
| 2 | `new AuditLog(…, { mirror: new OTelMirror(tracer) })` | every chained audit entry becomes an `audit.<type>` span |
| 3 | a pre-flight `budget({ onExceed: 'block' })` | an `audit.budget_event` span — the one signal a **refused** call ever leaves |

## Run it

```bash
cd recipes/observability/otel-export
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
calls that ran     : 2 (the next one was refused pre-flight: true)
metric counter     : gen_ai.client.token.usage = 3000 tokens
spans exported     : 4
span names         : audit.audit_open, audit.budget_event, audit.llm_call
verify(chain file) : true - ok: 4 entries, head 80127800dbae…
```

## ⚠️ `outputReserve` is what makes the block pre-flight

Without it the projection counts **input only**, so the cap is not crossed until settlement — and a
post-flight overspend throws `BudgetExceeded` **without emitting a `BudgetEvent`**, because by then
the call already happened and is already on the bus as an `LLMCall`. Same exception, same message
shape, and **no `audit.budget_event` span**. Measured while writing this recipe.

If you want the refusal signal, you have to actually be refused.

## The shapes that differ from Python

⚠️ **There is no `InMemoryMetricReader` in the JS SDK.** The equivalent is a
`PeriodicExportingMetricReader` wrapping an `InMemoryMetricExporter`, and you force a collection with
`await reader.forceFlush()` rather than reading the reader directly.

⚠️ **Injected `tracer` / `meter`, not a global provider.** In production you set the global once (one
line from your vendor's distro) and change nothing else. In a *test*, reaching for the global makes
an assertion that passes whether or not your code emitted anything.

## Honest limits

**The hash-chained file stays the sole verifiable evidence.** `verify()` runs on it, never on the
mirror. A mirror is best-effort and an operational copy — a failing one is swallowed rather than
breaking the chain, which is the right trade and also means you cannot audit from it.

Python twin: [`observability/otel-export`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/observability/otel-export) ·
Packages: `@cendor/acttrace`, `@cendor/core`, `@cendor/tokenguard`, `@opentelemetry/*` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/acttrace               ^3.1.0
@cendor/core                   ^3.4.0
@cendor/tokenguard             ^3.1.0
@opentelemetry/api             ^1.9.0
@opentelemetry/sdk-metrics     ^2.10.0
@opentelemetry/sdk-trace-node  ^2.10.0
```

⚠️ **A caret is not a floor you can forget.** At `3.x` a caret spans the whole major, so a newer
patch or minor than the numbers above is expected, not drift — but the reverse also holds:
`npm install` over an existing `node_modules` is **lock-obedient, not a refresh**, and will happily
leave you on an older 3.x while everything still passes. To move onto what is actually published:

```bash
rm -rf node_modules package-lock.json && npm install
node ../../../scripts/check-one-core.mjs .
```

That second line is the one that matters after any `@cendor/core` minor: **the whole `@cendor/*` set
moves together**, and a sibling left behind resolves a *second* copy of `@cendor/core` — two event
buses, so a guardrail decision never reaches the budget, and nothing fails to say so.
