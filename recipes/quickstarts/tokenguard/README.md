# tokenguard (JS) — stop a runaway agent loop before it overspends

**The pain.** An agent loop that retries, re-plans and re-reads its own context can burn a month's
budget in an afternoon, and the first you hear about it is the invoice. A per-request `max_tokens` does
not help: the problem is the *number* of requests, not the size of any one of them.

**What this shows.** `@cendor/tokenguard` prices every instrumented call against a cap and refuses the
one that would cross it — **pre-flight**, so the blocked request never leaves your process and costs
nothing. Spend is attributed by ambient tags, so the report says *which* part of the agent spent it.

## Run it

```bash
cd recipes/quickstarts/tokenguard
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
BudgetExceeded: pre-flight block: projected $0.539995 would exceed cap $0.5 (model=gpt-4o)

Turns that actually ran, by feature:
  planner     3 calls   $0.27
  researcher  2 calls   $0.18
  TOTAL       5 calls   $0.45

(The 6th turn was blocked pre-flight - $0 spent on it; the model never saw it.)
```

## Core concepts

| piece | what it does |
|---|---|
| `budget({ usd, onExceed, outputReserve })` | a spend cap over a scope. `onExceed: 'block'` checks the **projection** before the call and raises `BudgetExceeded` |
| `outputReserve` | how many output tokens to assume when projecting. Governs the *projection*, never the *record* |
| `track({ feature }, fn)` | ambient tags on every instrumented call made inside — including across awaits |
| `report(['feature'])` | spend grouped by tag; `.rows` and `.total()` |

## The shapes that differ from Python

⚠️ **`budget` is curried.** Write `budget(cfg)(fn)` — **never** `budget(cfg, fn)`. The two-argument
form is a decoy overload typed `never`, so the wrong shape is a compile error whose message states the
right one. For a callback scope use `withBudget(cfg, cb)`.

⚠️ **`track` takes a callback**, not a `with` block: `track(tags, fn)`. It is async, so `await` it.

⚠️ **`report()` returns rows on `.rows`** and the tag map is `row.tags`; keys stay snake_case on the
wire. Money is `decimal.js` — `row.usd.amount.toString()`, never `Number(...)`.

## Honest limits

⚠️ **The "6th turn" is a property of this fake, not of a real provider.** `OUT_TOKENS = 6000` is what
the fake reports as *settled* usage, and tokenguard bills what settles. A real model asked this
question answers in 30–60 tokens, so real spend is ~$0.016/turn rather than $0.09 — the cap is then
crossed around the **27th** turn (measured live 2026-07-31). Nothing is wrong here: `outputReserve`
governs the pre-flight projection and settled usage governs the record, and the two are *meant* to
differ. Against a real client, set the cap from a measured per-turn cost rather than reusing $0.50.

Prices come from the offline snapshot bundled in `@cendor/core`. A model the snapshot does not know is
reported unpriced rather than guessed.

Python twin: [`quickstarts/tokenguard`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/quickstarts/tokenguard) ·
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
