# contextkit (JS) — fit a prompt to a token budget without dropping the wrong things

**The pain.** Your prompt is over the window, so something has to go. Naive truncation lops off the
*end* — which is usually the pinned instructions or the user's actual question. And whatever you do,
you cannot explain afterwards what was dropped or why.

**What this shows.** `@cendor/contextkit` assembles blocks by declared priority, shrinks what it is
allowed to shrink, drops what it must, and hands back a **receipt**. Same inputs produce byte-identical
output, every time.

## Run it

```bash
cd recipes/quickstarts/contextkit
npm install
node index.mjs
```

## Expected output

```text
AssemblyReport(model=gpt-4o, order=default) budget=8000 reserved_output=500 used=7499/7500
  [kept      ] system    14->14tok
  [kept      ] user      16->16tok
  [truncated ] user      9004->7454tok
  [dropped   ] history   5000->0tok  # history: dropped all 40 turns (no room)

used 7499 <= budget 7500 (after 500-tok output reserve)  OK
same inputs -> identical output: true
```

The pinned system prompt and the user's question survive at 14 and 16 tokens. The 9,004-token docs
blob is **truncated** to fit the room that is left, and the 40-turn history is **dropped** entirely —
because it declared the lowest priority, which is exactly the instruction it was given.

## Core concepts

| piece | what it does |
|---|---|
| `new Block(content, { priority, pin, evict, role })` | one unit of context with packing *intent* |
| `pin: true` | never dropped, whatever the budget |
| `evict: 'truncate' \| 'drop_oldest' \| 'summarize' \| 'compress'` | how this block is allowed to shrink |
| `new Context({ budgetTokens, model, reserveOutput })` | the assembler; `reserveOutput` is held back for the answer |
| `ctx.report()` | the receipt — one `BlockDecision` per block: `action`, `tokensBefore`, `tokensAfter`, `note` |

## The shapes that differ from Python

⚠️ **`assemble()` is async in TypeScript** — there is one `await ctx.assemble()`, where Python has a
sync `assemble()` plus an async `aassemble()`. Summarizers and compressors are awaited, so the whole
path is async.

⚠️ **Options are an object, and report fields are camelCase** — `new Block(text, { priority, pin })`,
`report.reservedOutput`, `decision.tokensBefore`. The `evict` *values* stay snake_case
(`'drop_oldest'`) because they are wire strings shared with Python.

⚠️ **A `messages` block is constructed options-first** — `new Block({ messages, priority, evict })`,
because there is no positional content to lead with.

## Honest limits

Token counts come from `@cendor/core`'s counter for the named model; check `tokens.method(model)` to
see whether that is an exact tokenizer or an estimate. Determinism is over *inputs* — change a block's
content and the assembly legitimately changes.

⚠️ **`evict: 'compress'` needs `@cendor/squeeze` installed.** Without it, `onMissingCompressor`
decides what happens (`'note'` by default — it degrades and says so on the receipt, rather than
silently keeping the block whole).

Python twin: [`quickstarts/contextkit`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/quickstarts/contextkit) ·
Packages: `@cendor/contextkit` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/contextkit  ^3.1.0
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
