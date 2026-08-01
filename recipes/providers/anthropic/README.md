# anthropic (JS) — where prompt-cache billing has three rates, not one

**The pain.** Anthropic's prompt caching is the cheapest win available on a long system prompt — and
it makes cost arithmetic that used to be `in × rate + out × rate` wrong in a way that under-reports.
There are **three** input categories, and one of them costs *more* than uncached input.

**What this shows.** `instrument()` normalizes all three so the cost follows Anthropic's actual
formula.

## The five steps, in order

Every recipe in `providers/` walks the same five, so you can read one and then skim the rest:

| # | step | what it is here |
|---|---|---|
| 1 | **connect** | the provider's own client, untouched |
| 2 | **instrument** | one `instrument(client)` wrap — detection is *structural*, never by class name, which is why the offline fake is recognised exactly like the real thing |
| 3 | **govern** | a `@cendor/tokenguard` cap (pre-flight) **and** one `@cendor/guardrails` gate |
| 4 | **record** | `@cendor/cassette` — the same call replayed offline: 0 provider calls, $0 |
| 5 | **prove** | `@cendor/acttrace` `verify()` over the hash chain, and a cost from `prices` |

**What is DISTINCTIVE here: three input rates on one call.**

| field | what it is | rate |
|---|---|---|
| `input_tokens` | fresh, uncached input | standard |
| `cache_read_input_tokens` | served from the prompt cache | **cheap** |
| `cache_creation_input_tokens` | written *into* the cache | **more than standard** |

Cache reads are folded into `usage.inputTokens` as a `usage.cachedTokens` **subset** — so
`inputTokens` is the honest total you sent, and `cachedTokens` says how much of it was cheap.

## Run it

```bash
cd recipes/providers/anthropic
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
gate      : BLOCKED by keyword_deny (input) - denied keyword: "ignore previous instructions"
            provider saw 0 call(s) => $0 spent on it
budget    : BudgetExceeded - blocked pre-flight, no call ran
usage     : three input rates on ONE call
            input        20000 total (18000 of it cache READ, the cheap rate)
            cache write  4000 — its own category, and it costs MORE than uncached input
            output       900
            cost         $0.0399  <- Anthropic's formula, not a two-rate approximation
cassette  : replayed 1 call, 0 provider call(s), $0
verify()  : true - ok: 19 entries, head 79f467f66860… (signatures verified)
```

## The shape that differs from Python — and it is a real one

⚠️ **`messages.stream()` and `messages.parse()` are NOT instrumentation targets in TypeScript.**
In the JS SDK they are *helpers built on* `create`, so a target there double-counts one request.
**Python is the opposite**: each POSTs its own request and needs its own target (added in
`cendor-core` 1.17.0 — before that they emitted zero events). Same shape as openai's `parse`.

## Honest limits

⚠️ **Token counting for Claude is approximate BEFORE the call.** `o200k` under-counts Claude by a
measured **1.49×** on English and **1.14×** on code, and no scaling factor is applied — a guessed
correction would be a different kind of wrong. So a *pre-flight projection* on a Claude model is a
projection, and a tight `usd` cap can admit one more call than you expected. The number printed
above is **settled** usage — what Anthropic reported — and that one is exact.

Cap with headroom on Claude, or cap on `tokens` and read the projection as advisory.

## Going live

```bash
RECORD=1 ANTHROPIC_API_KEY=sk-ant-... node index.mjs
```

Python twin: [`providers/anthropic`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/providers/anthropic) ·
Packages: `@cendor/acttrace`, `@cendor/cassette`, `@cendor/core`, `@cendor/guardrails`, `@cendor/tokenguard`, `@anthropic-ai/sdk` · Offline ✓ · Live switch: `RECORD=1` · [← all recipes](../../../README.md)
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
@anthropic-ai/sdk   ^0.115.0
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
