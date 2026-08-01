# bedrock (JS) — every id is unpriced, and the usage keys are camelCase

**The pain.** You wire Bedrock into a governed app and get *nothing*: no cost, and — until recently
in TypeScript — no events at all. Two separate reasons, and neither announces itself.

**What this shows.** Both, fixed, on the real aws-sdk-v3 call shape.

## The five steps, in order

Every recipe in `providers/` walks the same five, so you can read one and then skim the rest:

| # | step | what it is here |
|---|---|---|
| 1 | **connect** | the provider's own client, untouched |
| 2 | **instrument** | one `instrument(client)` wrap — detection is *structural*, never by class name, which is why the offline fake is recognised exactly like the real thing |
| 3 | **govern** | a `@cendor/tokenguard` cap (pre-flight) **and** one `@cendor/guardrails` gate |
| 4 | **record** | `@cendor/cassette` — the same call replayed offline: 0 provider calls, $0 |
| 5 | **prove** | `@cendor/acttrace` `verify()` over the hash chain, and a cost from `prices` |

## ⚠️ This is `send(new ConverseCommand(…))`, not a `converse()` shim

Since **`@cendor/core` 3.3.0**, core detects an aws-sdk-v3 Bedrock Runtime client (by
`config.serviceId === 'Bedrock Runtime'`) and captures the Converse family **per command**. Before
that, libs-only TypeScript Bedrock got **zero** capture — no budget, no guard, no audit, no cassette
— which `cendor-testsuits` recorded every run as the most surprising gap in the JS port.

**Stop writing the synthetic `converse()` wrapper.** It still exists in `@cendor/sdk` and cannot
double-count (a nested `send` stands down), but you no longer need it.

`InvokeModelCommand` is deliberately **not** captured: its request and response bodies are opaque,
per-model-family JSON, so there is nothing core could read as messages or usage without guessing —
and a confidently wrong token count is worse than an honest gap. Any other AWS command through the
same `send` passes through untouched.

## What is DISTINCTIVE here: an unpriced id, and camelCase usage

Converse reports `usage: { inputTokens, outputTokens }` — camelCase, one level up from where an
OpenAI reader looks. And most Bedrock **model ids** are marketplace ids
(`eu.amazon.nova-2-lite-v1:0`) with no row in any price table. The recipe shows the two caps that
still work:

* a **token** budget binds with no rate at all — it counts tokens, not dollars;
* a **USD** budget binds after one `prices.registerModelPrice(...)` line, yours to supply.

## Run it

```bash
cd recipes/providers/bedrock
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
price     : eu.amazon.nova-2-lite-v1:0
            in the table before registering? false
gate      : BLOCKED by keyword_deny (input) - denied keyword: "ignore previous instructions"
            provider saw 0 call(s) => $0 spent on it
budget    : token cap bound with NO price at all — BudgetExceeded
            5 call(s) ran under a 20,000-token cap
            registerModelPrice() -> the SAME call now costs $0.000408
            and a USD cap now binds too — BudgetExceeded
cassette  : replayed 1 call, 0 provider call(s), $0
verify()  : true - ok: 11 entries, head 35dca99d80ff… (signatures verified)
```

## ⚠️ Not every Bedrock id is unpriced — which is worse than all of them being unpriced

The price lookup strips the region prefix, the vendor prefix and the `-v1:0` suffix. So a **current**
Bedrock Claude id prices itself with no registration at all
(`eu.anthropic.claude-sonnet-4-6-v1:0` → `claude-sonnet-4-6`), while Nova, Llama, Mistral and
**retired** Claude ids do not.

**The same cap, in the same code, binds on one model and is a silent no-op on the next.** That is
why this recipe asserts the price exists rather than trusting it — and why yours should too.

## Honest limits

The offline run fakes the *transport* only: the commands are the **real** `ConverseCommand` class
from `@aws-sdk/client-bedrock-runtime`, so the call shape above is exactly the production one.

Streaming (`ConverseStreamCommand`) is captured too, as an always-stream target. `InvokeModel` is
not — see above.

## Going live

```bash
RECORD=1 AWS_REGION=eu-west-1 BEDROCK_MODEL_ID=eu.amazon.nova-2-lite-v1:0 node index.mjs
```

⚠️ **A Bedrock API key is bearer auth and must be the ONLY credential set.** Parked in
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` instead, it fails with
`UnrecognizedClientException: The security token included in the request is invalid` — which reads
exactly like a dead or expired credential and is neither. The key id gives it away:
`BedrockAPIKey-…` (34 chars) with a ~132-char `ABSK…` secret, where SigV4 is `AKIA…`/`ASIA…` (20)
plus 40.

Python twin: [`providers/bedrock`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/providers/bedrock) ·
Packages: `@cendor/acttrace`, `@cendor/cassette`, `@cendor/core`, `@cendor/guardrails`, `@cendor/tokenguard`, `@aws-sdk/client-bedrock-runtime` · Offline ✓ · Live switch: `RECORD=1` · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/acttrace                 ^3.1.0
@cendor/cassette                 ^3.0.0
@cendor/core                     ^3.4.0
@cendor/guardrails               ^3.1.0
@cendor/tokenguard               ^3.1.0
@aws-sdk/client-bedrock-runtime  ^3.1101.0
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
