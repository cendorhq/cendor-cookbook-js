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
node index.mjs
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
[← all recipes](../../../README.md)
