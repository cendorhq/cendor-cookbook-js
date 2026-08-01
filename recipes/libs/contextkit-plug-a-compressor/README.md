# contextkit-plug-a-compressor (JS) — swap the compression backend, change no call sites

**The pain.** A general-purpose compressor is by definition ignorant of your domain. Your case logs
are 90% "agent viewed the order" boilerplate and 10% decisions; you know that and no library does. But
swapping the backend usually means touching every place that builds a prompt.

**What this shows.** contextkit does not know what squeeze is. When a block says `evict: 'compress'`
it asks whatever object matches core's `Compressor` protocol:

```ts
compress(content, { targetTokens, model }) -> [compressedText, handle]
```

`useCompressor(mine)` registers yours process-wide and every `evict: 'compress'` block uses it — no
call site changes. The recipe plugs in a `DecisionsOnly` compressor, then swaps back to squeeze and
compresses the same block so you can compare.

## Run it

```bash
cd recipes/libs/contextkit-plug-a-compressor
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
raw case log     : 1,547 tokens, 96 lines
DecisionsOnly    : 1547 -> 107 tok  (technique decisions-only, expand() exact: true)
squeeze (default): 1547 -> 243 tok  (technique extractive, expand() exact: true)
both satisfy the same protocol - contextkit imported neither, and no call site changed
the handle is the contract: whatever you plug in must be able to give the original back
```

The domain compressor wins on this content (107 vs 243 tokens) because it knows something the general
algorithm cannot. On prose it would be far worse. That is the argument for the seam, not for the
implementation.

**`expand() exact: true` is the contract.** contextkit surfaces the handle on the block's
`BlockDecision`, so a downstream step can recover what was dropped.

There is **no base class and no import from contextkit** — the protocol is satisfied by shape, so your
compressor can live anywhere. Every number matches the Python twin.

Python twin: [`libs/contextkit-plug-a-compressor`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/libs/contextkit-plug-a-compressor) ·
Packages: `@cendor/core`, `@cendor/contextkit`, `@cendor/squeeze` · Offline ✓ ·
Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
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
