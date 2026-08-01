# block-before-record (JS) — a call that never happened leaves nothing to replay

**The pain.** You wire a guardrail and a recorder into the same app and then have to reason about
which runs first. Get it backwards and your cassette fills with requests that were never sent — and a
later replay happily hands back a response for the exact call the guardrail exists to prevent.

**What this shows.** The ordering, as a measurement. `@cendor/guardrails` blocks **pre-flight**;
`@cendor/cassette` records on the **response**. So inside one
`cassette.using(..., { mode: 'record' })` scope, a clean prompt is sent and recorded, and a denied
prompt reaches the provider **zero** times and writes **zero** cassette entries.

## Run it

```bash
cd recipes/combos/block-before-record
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
clean request    : reached the provider, recorded
blocked request  : GuardrailTripped - guardrail "keyword_deny" blocked at stage "input": denied keyword: "wire transfer"
provider calls   : 1 (the blocked one never left the process)
cassette entries : 1 - one per call that actually happened
nothing to replay: a request that was refused has no recorded response to hand back
```

Two requests went into the scope; one call and one cassette entry came out. Both numbers are counted,
not claimed.

The consequence worth internalising: **your cassettes only contain traffic that was allowed.** A
cassette recorded in production is therefore safe to replay in CI without re-running the policy.

Call shape: `rules.keywordDeny([...], { action: 'block' })` — camelCase, and the options are an
object.

Python twin: [`combos/block-before-record`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/combos/block-before-record) ·
Packages: `@cendor/core`, `@cendor/guardrails`, `@cendor/cassette` · Offline ✓ ·
Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/cassette    ^3.0.0
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
