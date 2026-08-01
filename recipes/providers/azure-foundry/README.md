# azure-foundry (JS) — when a USD budget silently cannot bind

**The pain.** On Microsoft Foundry you call your **deployment name**, not a model id. Every price
table is keyed by model id, so the deployment has no row — the cost comes back `null`, and a USD
`budget(...)` counts every call as $0. Nothing errors. Your governance looks like it passed.

**What this shows.** That silence, reproduced on purpose, then removed by one line.

## The five steps, in order

Every recipe in `providers/` walks the same five, so you can read one and then skim the rest:

| # | step | what it is here |
|---|---|---|
| 1 | **connect** | the provider's own client, untouched |
| 2 | **instrument** | one `instrument(client)` wrap — detection is *structural*, never by class name, which is why the offline fake is recognised exactly like the real thing |
| 3 | **govern** | a `@cendor/tokenguard` cap (pre-flight) **and** one `@cendor/guardrails` gate |
| 4 | **record** | `@cendor/cassette` — the same call replayed offline: 0 provider calls, $0 |
| 5 | **prove** | `@cendor/acttrace` `verify()` over the hash chain, and a cost from `prices` |

**What is DISTINCTIVE here: money, and only money.** Usage, the gate, the cassette and the audit
chain are all exact on an unpriced deployment. It is the *cost* — and therefore every USD control
built on it — that quietly does nothing.

## Run it

```bash
cd recipes/providers/azure-foundry
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
tokenguard: no price for model 'prod-gpt4o-eastus', so the active USD budget (on_exceed='block')
counts its calls as $0 and cannot enforce a USD cap on it. …

deployment: prod-gpt4o-eastus  (a deployment NAME, not a model id)
unpriced  : cost = null
            a $0.06 USD cap let all 8 calls through — it could not bind.
            ^ nothing errored. That is the danger: it LOOKS governed.
fix       : prices.registerDeployment("prod-gpt4o-eastus", { like: "gpt-4o" })
priced    : the SAME call now costs $0.0425
            the SAME cap now blocks after 2 call(s) — enforceable at last.
gate      : BLOCKED by keyword_deny (input) - denied keyword: "ignore previous instructions"
            provider saw 0 extra call(s) => $0 spent on it
cassette  : replayed 1 call, 0 provider call(s), $0
verify()  : true - ok: 5 entries, head 168bccf9308c…
```

**One cap value, two outcomes.** $0.06 is used in both acts — unpriced it admits all 8 calls, priced
it admits 1 and refuses the rest. That is the whole recipe.

## Three traps this recipe exists to name

⚠️ **Use the v1 GA endpoint, not `AzureOpenAI`.** The GA path is the *standard* `openai` client with
`baseURL: '<endpoint>/openai/v1/'` — no `AzureOpenAI` class, no `api-version` parameter.

⚠️ **`azure-ai-inference` is captured by NOTHING.** It is a different client shape, so
`instrument()` hands it back untouched: no budget, no gate, no audit, no cassette, and nothing says
so. Microsoft retires it 2026-08-26 in any case.

⚠️ **A `model-router` deployment is not priceable.** The router bills at the *serving* model's rates
while the call reports the router's own id, so no single `registerDeployment` is ever correct.
Register nothing and read the honest `null` rather than a confidently wrong number.

## `registerDeployment` vs `registerModelPrice`

| | use it when |
|---|---|
| `prices.registerDeployment(name, { like: 'gpt-4o' })` | the deployment serves a model the table already knows. You name the model, not a rate — less to get wrong |
| `prices.registerModelPrice(name, { input: 2.5, output: 10 })` | you hold the actual rate card (a negotiated rate, a model with no row: DeepSeek, Mistral, Phi…) |

Both are **copy-at-registration**, not live aliases: a later `refresh()` that reprices the base does
not reprice your deployment. Call it again to pick up new rates.

## Honest limits

`registerDeployment` throws `UnknownModelError` if `like` is not in the table — deliberately.
Registering nothing and letting the deployment stay unpriced would reproduce the exact silence this
function exists to remove.

## Going live

```bash
RECORD=1 AZURE_OPENAI_ENDPOINT=… AZURE_OPENAI_API_KEY=… AZURE_OPENAI_DEPLOYMENT=… node index.mjs
```

Python twin: [`providers/azure-foundry`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/providers/azure-foundry) ·
Packages: `@cendor/acttrace`, `@cendor/cassette`, `@cendor/core`, `@cendor/guardrails`, `@cendor/tokenguard`, `openai` · Offline ✓ · Live switch: `RECORD=1` · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/acttrace    ^3.1.0
@cendor/cassette    ^3.0.0
@cendor/core        ^3.4.0
@cendor/guardrails  ^3.1.0
@cendor/tokenguard  ^3.1.0
openai              ^7.3.0
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
