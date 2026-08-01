# llamaindex (JS) — pack unbounded RAG retrieval into a token budget, reversibly

**The pain.** A retriever cheerfully returns six oversized nodes. Stuffing them all into the prompt
blows the context window; truncating loses the tail of whichever node got unlucky; and either way
you cannot explain afterwards what the model actually saw.

**What this shows.** `@cendor/contextkit` packs the retrieved nodes to a budget — compressing the big
ones with `@cendor/squeeze` and dropping what still will not fit — and prints a **receipt**. Each
compressed chunk keeps a handle that restores the original byte-for-byte.

LlamaIndex *works alongside* Cendor. Nothing is patched and no LlamaIndex API is wrapped: a real
`BaseRetriever` produces nodes, and contextkit packs them.

## Run it

```bash
cd recipes/frameworks/llamaindex
npm install
node index.mjs
```

## Expected output

```text
retriever returned 6 nodes

AssemblyReport(model=gpt-4o, order=default) budget=3000 reserved_output=200 used=2796/2800
  [kept      ] system    8->8tok
  [kept      ] user      6->6tok
  [kept      ] user      760->760tok
  [kept      ] user      760->760tok
  [kept      ] user      760->760tok
  [compressed] user      760->475tok
  [dropped   ] user      760->0tok  # no room (framing)
  [dropped   ] user      760->0tok  # no room (framing)

fits budget : used 2796 <= 2800
compressed  : 1 node(s), each holding a reversible handle
dropped     : 2 node(s) that still would not fit
expand()    : 4239 chars restored byte-for-byte
```

**Retrieval score becomes packing priority.** The retriever already ranked the nodes, so contextkit
does not have to guess — the lowest-scoring two are the ones dropped.

## ⚠️ contextkit auto-discovers squeeze

**Measured while writing this recipe:** removing the `compressor:` argument changes nothing — blocks
are still compressed and still reversible. `@cendor/contextkit` resolves `@cendor/squeeze` through
the optional peer when it is installed (tools never import each other; squeeze plugs in by shape).

So the explicit `compressor` is **not** what turns compression on — it is how you swap in your own.
What matters is **`onMissingCompressor`** for the case where squeeze is genuinely absent: the default
`'note'` degrades to a lossy truncate and says so on the receipt, which is easy to miss in
production. `'error'` refuses instead, which is right when reversibility is the point.

## The shape that differs from Python

⚠️ **`NodeWithScore` is a TYPE-only export** in the `llamaindex` npm package — there is no class to
construct. A plain `{ node, score }` object is exactly what the interface asks for.

## Honest limits

The compression ratio is a property of your content. These nodes are deliberately repetitive; dense
prose compresses far less. `expand()` reads from the in-process content-addressed store, so persist
the handle (`handle.toDict()`) alongside a durable store if you need it after a restart.

Python twin: [`frameworks/llamaindex`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/frameworks/llamaindex) ·
Packages: `@cendor/contextkit`, `@cendor/core`, `@cendor/squeeze`, `llamaindex` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/contextkit  ^3.1.0
@cendor/core        ^3.4.0
@cendor/squeeze     ^3.0.0
llamaindex          ^0.12.1
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
