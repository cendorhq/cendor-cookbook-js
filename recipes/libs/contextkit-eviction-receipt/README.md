# contextkit-eviction-receipt (JS) — read the receipt, not the vibes

**The pain.** Everyone writes the same helper eventually: *"if the prompt is too long, drop some
history."* Then a bug report arrives — the model forgot the system rules, or the retrieved doc it
needed is missing — and there is nothing to look at. Which block went? Why that one?

**What this shows.** contextkit makes the packing declarative and hands back a **receipt**. Each block
declares `priority` (higher survives longer), `pin: true` (never evicted, at any budget), `evict`
(what to do when it must shrink) and `keep` (which end of a truncation to keep). Then `report()`
returns an `AssemblyReport` with a `BlockDecision` per block: what happened, the tokens before and
after, and a note.

`whatif(n)` prices a tighter budget without committing to it — and leaves the committed report
untouched, which the recipe asserts.

## Run it

```bash
cd recipes/libs/contextkit-eviction-receipt
npm install
node index.mjs
```

## Expected output

```text
raw input        : 2,144 tokens
budget           : 1200 tokens (200 reserved for the answer)
used             : 1000 tokens in 18 messages
the receipt      :
  [kept      ] system       15 -> 15    tok
  [kept      ] system      608 -> 608   tok
  [truncated ] history     456 -> 285   tok  # history: kept 15 of 24 turns
  [truncated ] user        967 -> 17    tok
whatif()         : 1200->1000, 800->600, 500->300, 300->100
                   committed report untouched: true
pinned block     : kept at every budget - it is the reason the agent works
```

Four blocks, four decisions, and the priorities are visible in the outcome: the pinned rules survived
untouched, the high-priority policy was kept whole, the history lost its oldest 9 turns, and the
low-priority retrieved doc — the thing you can most afford to lose — was cut to 17 tokens.

**Byte-identical to the Python twin**, which is the parity claim worth having: the packer is the same
algorithm in both ports, not merely the same idea.

Call shapes: `await ctx.assemble()` and `await ctx.whatif(n)` are **async**; the report fields are
camelCase (`reservedOutput`, `tokensBefore`, `tokensAfter`).

Python twin: [`libs/contextkit-eviction-receipt`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/libs/contextkit-eviction-receipt) ·
Packages: `@cendor/core`, `@cendor/contextkit` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/contextkit  ^3.1.0
@cendor/core        ^3.4.0
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
