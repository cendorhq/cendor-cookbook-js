# guardrails-redteam (JS) — measure your guardrails' trip rate against a labeled corpus

**The pain.** "Our guardrails catch jailbreaks" is a claim, not a number. And an *unbenchmarked*
number is worse than none, because it will be repeated.

**What this shows.** `runRedteam(guardrails, corpus)` scores a gate against a labeled corpus and
reports trip rate, false-positive rate, and a per-category breakdown.

## Run it

```bash
cd recipes/governance/guardrails-redteam
npm install
node index.mjs
```

## Expected output

```text
9 cases: trip rate 50.0% (3/6 attacks), false-positive rate 0.0% (0/3 benign)

by category (attacks caught / attacks):
  leak       0/1
  override   2/3
  roleplay   1/2
```

## ⚠️ 50% is the honest number, and the recipe asserts it stays partial

Three of the six attacks contain a denylist phrase; three deliberately do not — an obfuscated
variant (`1gnore`), a translation framing, and a persona pivot.

**A corpus whose every attack matches your keywords prints a 100% trip rate for a keyword gate.**
That is the precise dishonest number this recipe exists to warn about, and the Python twin shipped
exactly it until 2026-07-30, when a new test asserted the score must be partial and caught it. This
twin inherits both the corpus and the assertion: if the trip rate ever reaches 100%, the recipe goes
**red**, because a perfect score here means the corpus was written to flatter the gate.

The false-positive assertion matters just as much. A gate that blocks benign traffic scores a
wonderful trip rate and is worse than no gate at all.

## The shapes that differ from Python

⚠️ **`report.byCategory` is a plain object**, not a `Map` — iterate with `Object.entries(...)`.
⚠️ The counter is **`report.caught`**, not `tripped`. ⚠️ **`loadCorpus` takes text or an array, never
a path** — it has no `node:fs` dependency, so read the file yourself and pass the contents
(`jsonl` / `json` / `csv`).

## Honest limits

**This is a measurement, not a claim — publish it only with the corpus named.** A trip rate is
meaningless without knowing what it was measured against.

Raise the number by **layering tiers** (a classifier, an `llmJudge`, a hosted rail), never by
overfitting keywords to the test set. The second is easy, looks identical in the report, and buys
you nothing against a real attacker.

Python twin: [`governance/guardrails-redteam`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/governance/guardrails-redteam) ·
Packages: `@cendor/guardrails` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
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
