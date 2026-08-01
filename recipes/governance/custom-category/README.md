# custom-category (JS) — catch a request by meaning, not the exact words

**The pain.** A keyword denylist blocks `"write python code"` and sails straight past the paraphrase
`"create an app"` — same intent, different words. Literal matching cannot see meaning.

**What this shows.** `semantic.customCategory(name, examples, embed, opts)` defines a category by a
few **example phrases** and trips when a turn is close enough to any of them. It is the local, $0
counterpart to a hosted "rapid custom categories" feature (examples → embedding search) — no cloud
call, no training step.

## Run it

```bash
cd recipes/governance/custom-category
npm install
node index.mjs
```

## Expected output

```text
"write python code for hello world"
  denylist fired: true   customCategory fired: true
    - denylist flag: denied keyword: "write python code"
    - code_requests flag: custom category "code_requests": sim 0.35 >= 0.3

"create a hello world app"
  denylist fired: false   customCategory fired: true
    - code_requests flag: custom category "code_requests": sim 0.35 >= 0.3
```

**Read the second block.** The denylist misses the paraphrase entirely; the semantic category
catches it. That contrast is the whole recipe — and the first block matters too, because a category
that fired on *everything* would look identical in the second block alone.

## `embed` is bring-your-own

| for | pass |
|---|---|
| **production** | `await embeddings.localEmbedder()` — zero-config, offline, `npm i @huggingface/transformers` |
| **this recipe** | a tiny 11-word bag-of-words vector defined inline |

⚠️ The inline `embed` is **not semantic** — it matches shared *words*. It is here so the recipe
needs no model download in CI, and it is why the threshold is `0.3` rather than the `0.6–0.8` a real
embedder wants. The Python twin does exactly the same thing for exactly the same reason.

## The shape that differs from Python

⚠️ **`localEmbedder()` is ASYNC in TypeScript** and the semantic checks then run on the async path —
use `applyAsync` / `evaluateAsync`, not the sync `apply()` / `install()` seam. Python's model2vec
embedder is a synchronous lookup; there is no maintained model2vec port for JS, so TS uses
transformers.js feature-extraction, which is async. The inline `embed` here is sync, which is why
this recipe can use the sync seam.

## Honest limits

**No catch-rate claim.** A similarity threshold is a heuristic. Keep the action on `flag` until you
have calibrated it against your own traffic — a `block` on an uncalibrated threshold will refuse
real users.

Python twin: [`governance/custom-category`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/governance/custom-category) ·
Packages: `@cendor/core`, `@cendor/guardrails` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/core        ^3.4.0
@cendor/guardrails  ^3.1.0
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
