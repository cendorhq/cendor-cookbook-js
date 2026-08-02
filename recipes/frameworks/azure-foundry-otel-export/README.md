# azure-foundry-otel-export (JS) — Foundry governance, exported as OpenTelemetry spans

**The pain.** You run on Microsoft Foundry and already have Azure Monitor. You want governance —
budgets, refusals, an audit trail — visible in the dashboard you already look at, without adopting
another vendor's agent.

**Which direction is this?** **Export** — you hold the client. Governance goes *out* to your backend
as spans. If a managed runtime owns the loop and you hold nothing, you want the other one:
[`frameworks/azure-foundry-otel`](../azure-foundry-otel/), which brings the runtime's `gen_ai.*` spans
*in* via `otel.ingest()`. They were one folder name until 2026-08-02, when the two languages turned
out to be covering different subjects under it.

**What this shows.** Both halves of the Foundry story, ending in ordinary OTel spans:

1. the **v1 GA endpoint** with the standard `openai` client;
2. `prices.registerDeployment(...)`, without which a USD budget cannot bind at all;
3. every governance event exported as a span your backend already understands.

## Run it

```bash
cd recipes/frameworks/azure-foundry-otel-export
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
deployment : prod-gpt4o-eastus -> priced like gpt-4o ($0.0425/call)
calls that ran : 1 (the next was refused pre-flight: true)
spans exported : 3 — audit.audit_open, audit.budget_event, audit.llm_call
refusal span   : audit.budget_event
verify(file)   : true - ok: 3 entries, head 4232cbaa5fc9…
```

**`audit.budget_event` is the line that matters.** A refused call makes no provider request, so this
span is the *only* trace of it that ever reaches your backend. Everything else you could reconstruct
from provider logs; a refusal you could not.

## ⚠️ Two ways to accidentally export nothing

**1. No `outputReserve` ⇒ no refusal span.** Without it the pre-flight projection counts input only,
the cap is crossed at *settlement* instead, and a post-flight overspend throws the same
`BudgetExceeded` while emitting **no `BudgetEvent`** — because by then the call already happened.
Measured while writing this recipe.

**2. A stub-sized prompt ⇒ no refusal span either.** The projection counts the tokens actually in
`messages`; the fake's reported `usage` only governs what settles. With a one-word prompt the
projection is ~nothing and the block is again post-flight. This recipe uses a realistic prompt for
exactly that reason.

## In production

```js
import { useAzureMonitor } from '@azure/monitor-opentelemetry';
useAzureMonitor();     // sets the GLOBAL provider; change nothing else
```

⚠️ The recipe injects an explicit `tracer` instead, because **asserting against the global provider
is an assertion that passes whether or not your code emitted anything** — there is always *a*
provider, and a no-op one records nothing and complains about nothing.

## Honest limits

⚠️ **The FILE is the evidence; the spans are an operational copy.** `verify()` runs on the file and
never on the mirror — losing your telemetry backend must not invalidate the record.

⚠️ **`azure-ai-inference` is captured by NOTHING** (different client shape; returned untouched, and
Microsoft retires it 2026-08-26). ⚠️ **A `model-router` deployment is not priceable** — it bills at
the serving model's rates while reporting the router's own id, so no single registration is correct.

Python twin: [`frameworks/azure-foundry-otel-export`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/frameworks/azure-foundry-otel-export) ·
Sibling (the other direction): [`frameworks/azure-foundry-otel`](../azure-foundry-otel/) — ingest a managed runtime's spans ·
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
