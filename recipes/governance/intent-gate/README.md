# intent-gate (JS) — decide whether a request should reach the model at all

**The pain.** Not every turn deserves a model call. A support bot asked to write poetry, a request
about a topic you do not serve — you want to catch that *before* you spend a token. A keyword
denylist is too literal, and a content classifier answers the wrong question: this is not "is it
unsafe?", it is "is it **on-task**?".

**What this shows.** Both directions of the same gate, on a backend you supply.

| mode | means |
|---|---|
| `allow` | these are the in-scope labels — flag anything else |
| `deny` | these labels are off-limits — refuse them |

## Run it

```bash
cd recipes/governance/intent-gate
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
=== on-topic (support) — passes ===
  "I can't reset my password, the login page shows an error" -> 0 decision(s)

=== off-topic — flagged before the model runs ===
  intent flag: off-topic (closest "support" 0.00 < 0.15)  metadata={"intent":"support","score":0}

=== deny-mode block === denied intent "billing": 0.33 >= 0.15
```

The recipe asserts **both** halves in each mode: allow-mode must pass the on-topic request *and*
flag the off-topic one; deny-mode must block the denied topic *and* leave an unrelated one alone. A
gate tested in one direction only is indistinguishable from a gate that always fires.

## Three backends, one seam

| backend | pass |
|---|---|
| **classifier** (used here) | `classify: (text) => ({ label: score })` — a CLU-style model, an ONNX head, or the toy keyword scorer in this file |
| **embeddings** | `embed` + exemplar phrases per label |
| **small-LLM judge** | `judge.intentPrompt(labels, { mode })` into `rules.llmJudge` — its own spend budgeted and audited |

## Honest limits

**Intent screening is a heuristic — no accuracy claim.** The classifier here is a deliberate toy
(keyword overlap) so the recipe stays offline; it is not a model. Calibrate the threshold on your own
traffic and prefer `flag` over `block` until you have. A too-tight allow-mode gate refuses your
actual users, which is a worse failure than letting a poem through.

Python twin: [`governance/intent-gate`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/governance/intent-gate) ·
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
