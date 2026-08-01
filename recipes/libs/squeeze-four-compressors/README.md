# squeeze-four-compressors (JS) — "compress this" means four different things

**The pain.** You have a 200 KB payload and a context window. Generic compression either mangles it or
barely helps, because a JSON blob, a log dump, a source file and a page of prose fail in completely
different ways — and the right move for one is the wrong move for another.

**What this shows.** squeeze runs a **different technique per kind**, and `detect()` picks one by
sniffing the content:

| kind | technique | why |
|---|---|---|
| `json` | minify + drop nulls | whitespace and empty fields are pure overhead |
| `logs` | normalize + dedup | blank the volatile fields, then near-identical lines collapse |
| `code` | strip comments and blank lines | structure is the signal, not the formatting |
| `prose` | extractive | keep the sentences carrying the most new information |

`fidelity` chooses how hard to push — `lossless`, `balanced`, `aggressive` — and every result stays
reversible, because the original lives in the content-addressed store.

## Run it

```bash
cd recipes/libs/squeeze-four-compressors
npm install
node index.mjs
```

## Expected output

```text
kind    detect() fidelity   tokens             ratio   technique
json    json     lossless    5,282 ->  3,123   59.1%   minify
json    json     balanced    5,282 ->  2,643   50.0%   minify+dropnulls
json    json     aggressive  5,282 ->  2,643   50.0%   minify+dropnulls
logs    logs     lossless   14,399 ->     35    0.2%   normalize+dedup
logs    logs     balanced   14,399 ->     35    0.2%   normalize+dedup
logs    logs     aggressive 14,399 ->     35    0.2%   normalize+dedup
code    code     lossless    1,309 ->  1,309  100.0%   code:lossless
code    code     balanced    1,309 ->    744   56.8%   code:balanced
code    code     aggressive  1,309 ->    744   56.8%   code:aggressive
prose   prose    lossless    1,501 ->  1,501  100.0%   extractive
prose   prose    balanced    1,501 ->    944   62.9%   extractive
prose   prose    aggressive  1,501 ->    683   45.5%   extractive

auto    detected logs, target 400 -> 35 tokens (normalize+dedup)
every row above is reversible: handle.expand() returned the original byte-for-byte
```

Three things worth reading off that table, all measured on this recipe's own inputs:

- **Logs compress ~400x.** Repetitive machine output is where squeeze is spectacular, because after
  normalization there are only a handful of distinct line patterns.
- **`lossless` is a real setting, not a slower `balanced`.** On code and prose it returns the input
  unchanged. On JSON it still wins 41%, because minification *is* lossless.
- **`aggressive` only differs where there is judgement to exercise** — prose drops another 17 points;
  JSON and logs are identical to `balanced`.

The json, logs and prose rows match the Python twin exactly. The `code` rows differ only because the
sample is JavaScript here and Python there — different source, same technique.

Call shape: `compress(content, { kind, fidelity, targetTokens, model })` — **one options object**,
where Python takes keyword arguments.

Python twin: [`libs/squeeze-four-compressors`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/libs/squeeze-four-compressors) ·
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
