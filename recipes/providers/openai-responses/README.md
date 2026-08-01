# openai-responses (JS) — the governed lifecycle where usage has four numbers, not two

**The pain.** You move to the Responses API (new OpenAI apps and the Agents SDK use it) and your
cost tracking quietly goes wrong. `prompt_tokens + completion_tokens` does not exist here, and the
two numbers that *do* exist hide two more inside them — both of which are billed, at different
rates.

**What this shows.** `instrument()` normalizes all four onto the same bus, so the cost matches the
invoice rather than the intuition.

## The five steps, in order

Every recipe in `providers/` walks the same five, so you can read one and then skim the rest:

| # | step | what it is here |
|---|---|---|
| 1 | **connect** | the provider's own client, untouched |
| 2 | **instrument** | one `instrument(client)` wrap — detection is *structural*, never by class name, which is why the offline fake is recognised exactly like the real thing |
| 3 | **govern** | a `@cendor/tokenguard` cap (pre-flight) **and** one `@cendor/guardrails` gate |
| 4 | **record** | `@cendor/cassette` — the same call replayed offline: 0 provider calls, $0 |
| 5 | **prove** | `@cendor/acttrace` `verify()` over the hash chain, and a cost from `prices` |

**What is DISTINCTIVE here: reasoning and cached tokens.** Cached input rides under
`input_tokens_details.cached_tokens` (billed cheaper); reasoning rides under
`output_tokens_details.reasoning_tokens` (billed as output, and invisible in the text you get back).
They surface as `usage.cachedTokens` and `usage.reasoningTokens`.

## Run it

```bash
cd recipes/providers/openai-responses
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
usage     : the Responses API reports four numbers, not two
            input      9000 (of which 6000 cached, billed cheaper)
            output     1200 (of which 800 reasoning, billed but unseen)
            cost       $0.027  <- from prices, not a literal
cassette  : replayed 1 call, 0 provider call(s), $0
verify()  : true - ok: 21 entries, head 4606e400e7e9…
```

## The shape that differs from Python — and it is a real one

⚠️ **`responses.parse` is NOT an instrumentation target in TypeScript, and that is deliberate.**
In `openai-node`, `parse` is a *helper built on* `create`, so instrumenting it would capture the
same HTTP request twice and charge two budgets for one call. **Python is the opposite**: there
`parse` POSTs its own request, so it needs its own target. Same shape as Anthropic's
`messages.parse`. If you are porting a Python recipe that lists `parse` as a target, drop it.

## Honest limits

The reasoning-token count is what the provider reports. You cannot see the reasoning text, and no
library can reconstruct it — you are billed for tokens you will never read. That is an OpenAI
product decision; surfacing the number honestly is all a cost tool can do.

## Going live

```bash
RECORD=1 OPENAI_API_KEY=sk-... node index.mjs
```

Python twin: [`providers/openai-responses`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/providers/openai-responses) ·
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
