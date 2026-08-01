# squeeze (JS) — shrink a huge blob before it eats your context window

**The pain.** A log dump, a JSON payload, a scraped page: 200 KB of mostly-repetition that you need
the model to reason about, and no room in the window for it. Truncating loses the tail; summarising
with a second model call costs money and is not reversible.

**What this shows.** `@cendor/squeeze` compresses toward a **token target** and hands back a
reversible handle. Send 58 tokens to the model; call `handle.expand()` and get all 235 KB back
byte-for-byte when you need the original.

## Run it

```bash
cd recipes/quickstarts/squeeze
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
kind detected : logs  (technique: normalize+dedup)
tokens        : 82,999 -> 58  (target 400)
234.8 KB -> 0.2 KB (99.9% smaller) · expand(): byte-for-byte identical OK
```

99.9% is what *this* content deserves — 1,500 log lines differing only in a counter. Your mileage
varies entirely with how repetitive the input is; see **Honest limits**.

## Core concepts

| piece | what it does |
|---|---|
| `compress(content, { kind, targetTokens, fidelity })` | returns `[small, handle]` |
| `kind: 'auto'` | detects `json` / `logs` / `code` / `prose` and picks the technique |
| `targetTokens` | a best-effort budget — never exceeded, often beaten |
| `handle.expand()` | the original, byte-for-byte, from the content-addressed store |
| `handle.technique` | what was actually done (`normalize+dedup` here) — surface it, don't assume it |

## The shapes that differ from Python

⚠️ **Options are an object with camelCase keys** — `compress(content, { targetTokens: 400 })`, not
`target_tokens=400`. The `kind` and `fidelity` *values* stay lowercase wire strings and are narrowed
to a union type, so a typo is a compile error.

⚠️ **Handle serialization is camelCase**: `handle.toDict()` / `Handle.fromDict(data)`. Python uses
`to_dict` / `from_dict`. The **serialized keys inside** stay snake_case (`original_ref`,
`restore_map`) because that JSON crosses between the two languages.

## Honest limits

**The compression ratio is a property of your content, not of squeeze.** Highly repetitive logs
compress enormously; dense prose barely at all. There is no universal number, and this recipe's 99.9%
is not one — measure your own payload.

`expand()` reads from the active content-addressed store. The default store is **in-process**, so a
handle does not survive a restart on its own — persist it with `handle.toDict()` alongside a durable
store (`useStore(...)`) if you need it later. See `libs/squeeze-persist-and-restore`.

Python twin: [`quickstarts/squeeze`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/quickstarts/squeeze) ·
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
