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
[← all recipes](../../../README.md)
