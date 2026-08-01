# compress-and-restore (JS) — an eviction you can audit *and* undo

**The pain.** Fitting a long transcript to a budget usually means throwing turns away. You lose
information you might need later, and you have no record of what went — and if the content is
sensitive, you cannot solve the record problem by logging what you dropped.

**What this shows.** `evict: 'compress'` routes the block through core's `Compressor` **protocol** to
whatever backend you registered with `useCompressor()` — here `@cendor/squeeze`, which returns a
reversible handle. squeeze emits a **metadata-only** `CompressionEvent` on core's bus, and an attached
`@cendor/acttrace` chain records it as a `compression` entry: technique, tokens before/after, handle
id, and **never the text**. `decompress(handle)` restores the original byte-for-byte.

## Run it

```bash
cd recipes/combos/compress-and-restore
npm install
node index.mjs
```

## Expected output

```text
original         : 1,999 tokens
after compress   : 264 tokens  (extractive, ratio 0.132)
audit entry      : type=compression handle_id=1a9034a4180b…
leaked content   : false  (metadata only — the chain never holds the text)
decompress()     : byte-for-byte identical true
verify()         : true — ok: 3 entries, head d036681f7780…
```

`leaked content: false` is a real check, not a promise: the recipe plants a marker string in the
transcript and asserts it appears in no field of the audit payload.

The token counts, ratio and **handle id are identical to the Python twin** — the two ports hash the
same content the same way, which is what makes a cross-language store interoperable.

Python twin: [`combos/compress-and-restore`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/combos/compress-and-restore) ·
Packages: `@cendor/core`, `@cendor/contextkit`, `@cendor/squeeze`, `@cendor/acttrace` · Offline ✓ ·
Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/acttrace    ^3.1.0
@cendor/contextkit  ^3.1.0
@cendor/core        ^3.4.0
@cendor/squeeze     ^3.0.0
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
