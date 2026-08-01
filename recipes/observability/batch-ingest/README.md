# batch-ingest (JS) — account for a completed Batch API job's spend

**The pain.** The Batch API halves your bill and takes your governance with it. The job runs
server-side and returns hours later, so there is nothing to intercept: no budget can refuse it, no
guardrail can redact it. Most tooling responds by not counting it at all.

**What this shows.** The **accounting** is fully recoverable after the fact. Each result line carries
its usage, and `otel.ingest(...)` turns those `gen_ai.*` numbers into a normalized `LLMCall` on the
same bus a local call rides — so tokenguard prices and reports it, and an `OTelSink` or acttrace
mirror sees it, exactly as if it had been instrumented locally.

## Run it

```bash
cd recipes/observability/batch-ingest
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
ingested   : 3 result line(s) from batch_68f2c1a9
spend      : {"feature":"nightly-summaries","batch_id":"batch_68f2c1a9"}  3 calls  5090 tok  $0.0209
total      : $0.0209  — priced by the same table a live call uses
```

## The two scopes that make it useful

```js
await trace(batchId, () =>
  track({ feature, batch_id: batchId }, () => { /* one otel.ingest(...) per line */ }),
);
```

`track(...)` tags the spend so it shows up under a feature; `trace(batchId)` correlates every line as
**one run**, because `ingest` stamps the ambient trace id onto the call. Without them you get
accurate numbers attached to nothing.

## Honest limits

⚠️ **This is ACCOUNTING, not governance, and the distinction is not a technicality.** A Batch job
cannot be refused, clamped, downgraded or redacted by anything running in your process, because your
process is not in the loop. What you get back is a faithful, priced, attributable record — and
pretending otherwise would be the one dishonest thing this recipe could do.

In production you stream the job's downloaded `output.jsonl`; the canned payload here is the same
shape, trimmed to the fields that matter for accounting.

Python twin: [`observability/batch-ingest`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/observability/batch-ingest) ·
Packages: `@cendor/core`, `@cendor/tokenguard` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/core        ^3.4.0
@cendor/tokenguard  ^3.1.0
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
