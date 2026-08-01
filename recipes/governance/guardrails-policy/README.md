# guardrails-policy (JS) — declare guardrails in a versioned file, prove which one was active

**The pain.** Your guardrails live in code, scattered across the app. When an auditor asks *"what
policy was enforcing this call, on this date?"* you are grepping git history — and you still cannot
prove the answer was not edited afterwards.

**What this shows.** `loadPolicy(text)` builds the guardrail list from **data**. Every decision it
makes carries the policy's version and hash into the tamper-evident audit chain, so the evidence
answers the auditor's question by itself.

## Run it

```bash
cd recipes/governance/guardrails-policy
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
loaded policy 2026-07-09 — sha256:8371aae241de06dfad6839f48f568d29b008021025d711efb03dbc0eef9b7d15
REDACTED before send: provider received "my key is [redacted]"
BLOCKED pre-spend: guardrail "keyword_deny" blocked at stage "input": denied keyword: "ignore previous instructions"  ($0 spent — 1 call so far)

every decision proves which policy was active:
  redact regex_rule   policy=2026-07-09
  block  keyword_deny policy=2026-07-09

chain verifies: true  (policy_hash sha256:8371aae… is in the evidence)
```

## The two shapes that differ from Python

⚠️ **`LoadedPolicy` IS the guardrail array.** It extends `Array<Guardrail>` and hangs `policyHash` /
`policyVersion` off it. So `install(policy)` — **never** `install(policy.guardrails)`, which throws
`guardrails is not iterable`. (Measured while writing this recipe.)

⚠️ **`loadPolicy` takes the policy TEXT or an object, never a path.** It has no `node:fs` dependency
by design, so it works unchanged in a browser or a Worker. Read the file yourself.

## JSON, not YAML

`loadPolicy` parses **JSON** natively. For YAML you supply the parser
(`loadPolicy(text, { parse: YAML.parse })`), which would mean a `yaml` dependency this recipe does
not need. **The schema is identical to the Python twin's** — only the serialization differs.

## Honest limits

A policy hash proves *which document* was active, not that the document was **adequate**. It moves
the argument from "prove you had a policy" to "let's discuss whether this policy was the right one",
which is the conversation worth having.

`acttrace` produces **evidence to support** a compliance case, never a guarantee.

Python twin: [`governance/guardrails-policy`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/governance/guardrails-policy) ·
Packages: `@cendor/acttrace`, `@cendor/core`, `@cendor/guardrails` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/acttrace    ^3.1.0
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
