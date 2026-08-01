# cassette (JS) — record an agent call once, replay it forever

**The pain.** Every CI run that hits a real model costs money and flakes. So teams mock the client by
hand, the mock drifts from the real response shape, and the test ends up proving that the mock still
matches the mock.

**What this shows.** `@cendor/cassette` records the real exchange once and replays it after — same
code path, same assertion, **zero** provider calls, no network, no key.

## Run it

```bash
cd recipes/quickstarts/cassette
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
run 1: recorded (1 call, 9.7 ms)
run 2: replayed (0 calls, offline, 1.8 ms)
same assertion green: true == "Refund issued."
```

The timings vary; **the two call counts do not**. `1` then `0` is the entire claim.

## Core concepts

| piece | what it does |
|---|---|
| `cassette.use(path, { mode })(fn)` | decorator form — returns an async wrapper |
| `cassette.using(path, { mode }, fn)` | callback-scope form, for a block rather than a function |
| `mode: 'auto'` | record if the file is absent, replay if it is there — no flag needed in CI |
| `semanticMatch(actual, expected)` | assert on *meaning*, so a re-recorded fixture doesn't break the test |

## Why the recipe counts calls instead of comparing strings

A replay test that only compares **output** passes just as happily if the "replay" quietly re-called
the provider — you would be paying for the call and testing nothing. `calls.n` is read from inside the
fake client, so `1` on record and `0` on replay is a claim about the *provider being reached*, which
is the thing you actually care about.

## The shapes that differ from Python

⚠️ **Both forms are async** — `await cassette.use(path)(fn)()`, `await cassette.using(path, fn)`.
Python's `use` decorates a sync function and `using` is a `with` block.

⚠️ **`semanticMatch`, not `semantic_match`.** The camelCase rename applies across the package
(`lexicalScore`, `embeddingScorer`, `openaiEmbeddingScorer`).

⚠️ **The cassette file format is shared with Python** — a tape recorded by the Python twin replays
here and vice versa. Keys inside it stay snake_case for that reason.

## Honest limits

A cassette replays a **recorded** exchange. If your prompt changes, the request hash changes and the
entry no longer matches — that is a drift signal, not a bug, and `mode: 'rerecord'` is how you accept
it. See `libs/cassette-four-modes` for all four, and `libs/cassette-semantic-drift` for scoring a
replay whose wording has legitimately moved.

`localEmbeddingScorer` is **Python-only** (model2vec has no maintained JS port). In TypeScript,
`semanticMatch` uses the lexical scorer by default and `openaiEmbeddingScorer` is the BYO path — see
the [parity matrix](https://github.com/cendorhq/cendor-libs-js/blob/main/docs/parity.md).

Python twin: [`quickstarts/cassette`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/quickstarts/cassette) ·
Packages: `@cendor/cassette`, `@cendor/core` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/cassette  ^3.0.0
@cendor/core      ^3.4.0
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
