# azure-foundry-otel (JS) — budget + audit calls your process never made

**Which direction is this?** **Ingest** — a managed runtime owns the loop and you hold nothing.
Its `gen_ai.*` spans come *in* via `otel.ingest()`. If you hold the client and want governance to go
*out* to your backend as spans, you want
[`frameworks/azure-foundry-otel-export`](../azure-foundry-otel-export/).

> These were one folder name until 2026-08-02. The Python file was ingest, the TypeScript file was
> export, and the `/cookbook` card described only the Python one — so a reader who clicked
> **TypeScript recipe →** landed on something that did not do what the card promised. A recipe folder
> name is an API shared by both trees; the name was stable and the *meaning* was not.

**The pain.** The Agent Service in Microsoft Foundry (formerly Azure AI Foundry) runs the agent loop
server-side. Your process never sees the calls, so there is nothing for `instrument()` to wrap — and
your budgets and audit trail go blind exactly where the spend is.

**What this shows.** The runtime emits OpenTelemetry `gen_ai.*` spans. Forward each span's attributes
to `otel.ingest()` and the call lands on the same cendor bus a local call rides — so `tokenguard`
prices and reports it, and `acttrace` chains it, exactly as if you had made the call yourself.

## Run it

```bash
cd recipes/frameworks/azure-foundry-otel
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
ingested 3 Foundry gen_ai.* spans (calls this process never made)
tokenguard: $0.018325 across 3 calls
acttrace  : 3 llm_call entries, verify: true
```

## The two adoption points, and how to tell which one you need

`instrument()` wraps **a client you hold**. `otel.ingest()` takes **telemetry about a call you did
not make**. They are not alternatives to weigh up — the topology decides:

| you hold… | use | this recipe |
|---|---|---|
| the provider client (`openai`, `anthropic`, aws-sdk-v3 …) | `instrument(client)` | [`azure-foundry-otel-export`](../azure-foundry-otel-export/) |
| nothing — a managed runtime ran the loop | `otel.ingest(attributes)` | **this one** |

`ingest()` is also the adoption point for anything else that reports after the fact: see
[`observability/batch-ingest`](../../observability/batch-ingest/) for a completed Batch API job, where
pre-flight governance is structurally impossible and the accounting is still fully recoverable.

## Honest limits

⚠️ **`ingest()` normalizes telemetry; it does not measure.** It trusts the runtime's numbers. A span
carrying no usage attributes yields a call with `usage: null` and no cost — never a guess.

⚠️ **Post-hoc means post-hoc.** Nothing here can *block* a call: the runtime already made it. You get
accounting, attribution and an audit trail, not a pre-flight breaker. A budget over ingested calls
tells you that you overspent, and cannot stop you.

⚠️ **A Foundry DEPLOYMENT name is unpriced.** These spans report `gpt-4o`, a real model id. A runtime
reporting `prod-gpt4o-eastus` needs `prices.registerDeployment('prod-gpt4o-eastus', { like: 'gpt-4o' })`
first, or the cost is `null` — and a `model-router` deployment is never priceable, because it bills at
the serving model's rates while reporting the router's own id.

Python twin: [`frameworks/azure-foundry-otel`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/frameworks/azure-foundry-otel) ·
Sibling (the other direction): [`frameworks/azure-foundry-otel-export`](../azure-foundry-otel-export/) ·
Packages: `@cendor/acttrace`, `@cendor/core`, `@cendor/tokenguard`, `@opentelemetry/*` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)

## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/acttrace               ^3.1.0
@cendor/core                   ^3.7.0
@cendor/tokenguard             ^3.2.0
@opentelemetry/sdk-trace-node  ^2.10.0
@opentelemetry/api             ^1.9.0
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
