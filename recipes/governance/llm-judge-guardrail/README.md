# llm-judge-guardrail (JS) — screen with a model, and budget/audit the judge itself

**The pain.** Deterministic rules cannot catch a *novel* jailbreak they were never told about. So you
want a model to judge open-ended risk — but a second model call costs real tokens, and most "AI
firewall" products hide that cost from you entirely.

**What this shows.** The judge is just another instrumented client. Its spend lands on the same bus
as everything else, so `report()` can price your safety layer. And the whole screening session runs
inside a cassette, so CI replays it with zero API calls.

## Run it

```bash
cd recipes/governance/llm-judge-guardrail
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
benign  -> allowed
attack  -> blocked: prompt-injection

the judge's own spend is budgeted + attributed (2 call(s), 102 tokens) — the guardrail is itself
measured, on the same bus as every other call.
```

**`2 call(s), 102 tokens`** is the line that distinguishes this from every hosted safety product: you
can see the bill for being safe. A judge whose spend never reached the bus would print `0 call(s)`,
and the recipe asserts it does not.

## The shape that differs from Python — and it will bite you

⚠️ **Use `applyAsync`, not `apply`.** The judge's check awaits a model call. The **sync** seam
deliberately throws `guardrail "…" is async; use evaluateAsync` rather than silently treating a
pending Promise as "no verdict" — which would be a gate that never fires and never says so.

Python's `apply` handles both, so this is the single most likely porting slip in this category. The
same applies to `install()` and `scoped()`: a judge-backed rail belongs on the async seam.

## Honest limits

**No catch-rate claim.** An LLM judge is only as good as its model and its prompt, and — unlike a
regex — **it is itself attackable**: the payload it is judging is the payload it reads.

Layer it **behind** deterministic rules, never instead of them. Keyword and regex rules are free,
run first, and cannot be talked out of it. See
[`guardrails-redteam`](../guardrails-redteam/README.md) for how to measure the pair honestly.

Python twin: [`governance/llm-judge-guardrail`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/governance/llm-judge-guardrail) ·
Packages: `@cendor/cassette`, `@cendor/core`, `@cendor/guardrails`, `@cendor/tokenguard` · Offline ✓ · Live switch: none (deleting the fixture re-records against the offline FAKE judge, not a live model) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/cassette    ^3.0.0
@cendor/core        ^3.4.0
@cendor/guardrails  ^3.1.0
@cendor/tokenguard  ^3.1.0
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
