# vitest-cassette (JS) — a test suite that never calls a provider

**The pain.** Every CI run that hits a real model costs money and flakes. So teams hand-write a mock,
the mock drifts from the real response shape, and the suite ends up proving that the mock still
matches the mock.

**What this shows.** A **vitest** suite that records the real exchange once and replays it after —
same code path, same assertions, zero provider calls, no key, no network.

| file | what it is |
|---|---|
| `agent.mjs` | the application under test. Nothing test-specific — the suite records and replays *this*, unmodified |
| `agent.test.mjs` | the suite. Two tests, both offline |
| `index.mjs` | the CI entry point: runs the suite and asserts it passed |

## Run it

```bash
cd recipes/testing/vitest-cassette
npm install
npm test          # the suite (vitest runs agent.test.mts directly)
node index.mjs    # the CI wrapper — plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
 Test Files  1 passed (1)
      Tests  2 passed (2)

test files : 1
tests      : 2
failed     : 0

OK — the suite passed with zero provider calls.
```

## ⚠️ The folder name is a deliberate exception

Its Python twin is [`testing/pytest-cassette`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/testing/pytest-cassette). Everywhere else in the
two cookbooks **a recipe folder name is identical across trees** — but `pytest` is a Python toolchain
name, and a TypeScript folder called `pytest-cassette` would be wrong on its face. The twin genuinely
*is* a different test runner, so the name says so. This is the only such exception in the repo, and
it is recorded in [`CLAUDE.md`](../../../CLAUDE.md).

## Three things this recipe is careful about

**1. It counts provider calls, not strings.** A replay test that only compares output passes just as
happily if the "replay" quietly re-called the provider. `providerCalls.n` going `1` → `0` is the
claim.

**2. The wrapper asserts tests RAN.** A suite that discovered zero files has zero failures, and
`failed === 0` alone would call that a pass — the most common way a test wrapper lies to you.

**3. It uses vitest's programmatic API.** Two dead ends were tried first and both fail in a way that
looks like something else: `spawnSync('npx', …, { shell: true })` trips node 24's DEP0190 warning,
and resolving the bin path fails twice over (`vitest/vitest.mjs` is the `bin` entry but is **not** in
the package's `exports` map, and `vitest/node` resolves into `dist/`, one level below where
`vitest.mjs` lives). Also: **`--reporter=basic` was removed in vitest 4** and passing it fails at
startup with an `ERR_LOAD_URL` that reads like a broken install.

## ⚠️ `semanticMatch` is LEXICAL by default in TypeScript

The default scorer is `lexicalScore` with a `0.6` threshold — token overlap, not meaning. Measured on
this recipe's fixture: the reword the test uses scores **0.75**, while a true paraphrase
("refunds take about five business days") scores **0.51** and would **fail**.

Python defaults the same way, but Python can also reach for `localEmbeddingScorer` (model2vec), which
has **no maintained JS port**. For real paraphrase tolerance in TypeScript, pass
`openaiEmbeddingScorer(...)` as the fourth argument — which costs a call, and is a choice, not a
default.

## Honest limits

A cassette replays a **recorded** exchange. Change the prompt and the request hash changes, so the
entry no longer matches — that is a drift signal, not a bug, and `mode: 'rerecord'` is how you accept
it.

Python twin: [`testing/vitest-cassette`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/testing/vitest-cassette) ·
Packages: `@cendor/cassette`, `@cendor/core`, `vitest` · Offline ✓ · Live switch: none (deleting the fixture re-records against the offline FAKE client, not a live model) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/cassette  ^3.0.0
@cendor/core      ^3.4.0
vitest            ^4.1.10
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
