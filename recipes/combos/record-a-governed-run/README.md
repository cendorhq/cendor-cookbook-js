# record-a-governed-run (JS) — record the governed triad once, re-run it for $0

**The pain.** The usual objection to testing governance is the bill: if every CI run makes real calls
to prove your budget blocks and your audit chain verifies, you pay to prove it — every push, every
branch, every retry. So the governance tests get skipped.

**What this shows.** Record a run that is budgeted (`@cendor/tokenguard`) and audited
(`@cendor/acttrace`) into a `@cendor/cassette`. On replay the provider is **never reached** — yet the
same budget accrues the recorded usage, the same audit chain is written, and `verify()` returns
`true`.

The `$0` claim is *proven*: the replay pass is handed a client that throws if it is called at all.

## Run it

```bash
cd recipes/combos/record-a-governed-run
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
record  : provider called 1x · 960 tok · $0.00345
replay  : provider called 0x · 960 tok · $0.00345
          ^ the same tokens are accounted, with $0 of REAL spend
answer  : "three fixes, one feature"
audited : 1 llm_call entry chained on the replay
verify(): true — ok: 2 entries, head 088b1f9c0c8b…
cassette: 779 bytes on disk — commit it and CI runs free
```

Read the two spend rows together. They are identical because tokenguard accounts the *recorded* usage
on replay — so a test can still assert "this feature costs under $X" — while `provider called 0x` is
what your invoice sees.

Both passes are wrapped in `track({ feature }, cb)`, which is why `report(['feature'])` can tell
them apart. Note the shape: TypeScript's `track` and `withBudget` are **async callback scopes**, not
`with` blocks.

Python twin: [`combos/record-a-governed-run`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/combos/record-a-governed-run) ·
Packages: `@cendor/core`, `@cendor/cassette`, `@cendor/tokenguard`, `@cendor/acttrace` · Offline ✓ ·
Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/acttrace    ^3.1.0
@cendor/cassette    ^3.0.0
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
