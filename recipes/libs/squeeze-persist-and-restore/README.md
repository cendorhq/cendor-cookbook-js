# squeeze-persist-and-restore (JS) — restore the original after the process is gone

**The pain.** You compressed a 40 KB incident report down to 30 tokens, stored the handle in your
database, and shipped. Next week someone asks what the original said — and `expand()` throws, because
the store that held it lived in a process that exited days ago.

**What this shows.** squeeze keeps the original in a **content-addressed store** keyed by the hash of
the content. The default store is in-process: right for a request handler, wrong for anything that
outlives one. `useStore(backend)` swaps it — and a backend is **any** object with `get(key) -> string`
and `put(key, value) -> void`. The recipe writes a nine-line file-backed one, so the whole
`StoreBackend` contract is visible and nothing native is needed (see the note below).

Then the handle is portable: `handle.toDict()` is JSON, `Handle.fromDict(...)` rebuilds it, and
`expand()` resolves through whatever store is active *now*.

Proven across a **real process boundary**: the recipe re-executes itself with `--restore`, in a second
node process that shares nothing but two files on disk. That child also tries the same handle against
a fresh `MemoryStore()`, so the failure mode is measured rather than described.

## Run it

```bash
cd recipes/libs/squeeze-persist-and-restore
npm install
node index.mjs
```

## Expected output

```text
  process 1 pid    : 7956
  compressed       : 15,999 -> 30 tokens (normalize+dedup)
  store on disk    : originals.json, 42,259 bytes
  handle.toDict()  : 196 bytes of JSON - this is what you persist, not the original
-- process ends here; everything in memory is lost ------------------
  process 2 pid    : 38652 (a different interpreter)
  MemoryStore()    : KeyError - the in-process store died with the first process
  FileStore(...)   : restored 41,689 chars, sha256 matches: true
```

(The pids differ every run — that is the point.)

Same handle, two stores: the in-memory one cannot help and says so immediately; the durable one
returns all 41,689 characters, and the sha256 matches the digest recorded before the first process
exited. The token counts and the restored length match the Python twin exactly.

**What you persist is the ~200-byte handle, not the original.** The original is in the store, deduped
by content hash — so the same document compressed twice costs one copy. The store must be set
**before** anything is compressed, or the original lands in the in-process default.

## ⚠️ Why this recipe does not use `SQLiteStore`

`@cendor/squeeze` ships `SQLiteStore` on the `@cendor/squeeze/store` subpath, and the Python twin uses
its equivalent. **The casing is the same in both ports** (`SQLiteStore`, not `SqliteStore`) — but the
JS one is backed by the optional native `better-sqlite3`, and **measured 2026-07-31,
`better-sqlite3@12.11.1` publishes no prebuilt binary for Node 20 on linux-x64**:

```text
prebuild-install warn install No prebuilt binaries found (target=20.20.2 runtime=node arch=x64 libc= platform=linux)
gyp ERR! find Python  Could not find any Python installation to use
```

On `node:22-slim` the same install succeeds in 7 seconds. A recipe pinned to it would therefore be
**green on Node 22 and red on Node 20** — exactly the failure the node 20 + 22 matrix exists to catch.
Python's twin uses the stdlib `sqlite3` and needs nothing extra, which is why it *does* use
`SQLiteStore` and closes that API there.

Use `SQLiteStore` in your own app if you already build native modules. The point this recipe makes —
that durability is a swappable backend and the handle is portable JSON — is the same either way.

Python twin: [`libs/squeeze-persist-and-restore`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/libs/squeeze-persist-and-restore) ·
Packages: `@cendor/core`, `@cendor/squeeze` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/core     ^3.4.0
@cendor/squeeze  ^3.0.0
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
