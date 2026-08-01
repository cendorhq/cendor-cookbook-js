# context-under-budget (JS) — the budget binds on what actually ships

**The pain.** You set a token cap based on the prompt you *wrote*, but what leaves the process is the
prompt your context assembler *built* — after eviction, compression and framing. Guess at that number
and you either overspend, or you clamp a request that was already small.

**What this shows.** `@cendor/contextkit` assembles an oversized JSON block to a 220-token budget,
routing the eviction through core's `Compressor` **protocol** to `@cendor/squeeze` (registered once
with `useCompressor`). The assembly receipt (`report().used`) is then proven to be the *real* token
count of the assembled messages, and `@cendor/tokenguard`'s `clamp` binds on that same number —
measured by a fake provider that bills exactly what it was sent.

Three libraries cooperating with **zero imports between them**.

## Run it

```bash
cd recipes/combos/context-under-budget
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
raw block        : 4,405 tokens  (12.6 KB of JSON)
assembled        : 199 tokens of a 220-token budget
eviction         : compressed (4405 -> 181 tok), reversible
billed input     : 199 tokens  == the receipt: true
clamp injected   : max_completion_tokens=50  (1 clamp recorded)
cost projection  : $0.0017775 assembled vs $0.01231 raw
```

The receipt (199) **is** the billed input, the clamp injected a server-side output ceiling rather
than throwing, and the projection over the assembled prompt is ~7x cheaper than over the raw block.

> **Parity note.** The `raw block` figure differs from the Python twin (4,405 vs 6,004 tokens) for a
> boring reason: `JSON.stringify` emits no space after `:` and `,` while Python's `json.dumps` does,
> so the two fixtures are not the same bytes. Everything the recipe actually asserts — the assembled
> count (199), the eviction, the injected ceiling (50) — is identical in both languages.

Call shapes that differ from Python: `new Context({ budgetTokens, model, reserveOutput })`,
**`await ctx.assemble()`** (async), `withBudget(cfg, cb)` (never `budget(cfg, fn)`), and camelCase
report fields (`tokensBefore`).

Python twin: [`combos/context-under-budget`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/combos/context-under-budget) ·
Packages: `@cendor/core`, `@cendor/contextkit`, `@cendor/squeeze`, `@cendor/tokenguard` · Offline ✓ ·
Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/contextkit  ^3.1.0
@cendor/core        ^3.4.0
@cendor/squeeze     ^3.0.0
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
