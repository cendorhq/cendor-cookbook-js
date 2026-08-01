# pii-guardrail (JS) — PII/secrets as a guardrail, with the audit trail to prove it

**The pain.** You want PII and secrets scrubbed *before* a payload reaches the model — and you want
**one** detection engine, not a second half-baked regex list bolted onto your guardrails and drifting
away from the first.

**What this shows.** `@cendor/acttrace` already ships the detector catalogue, with real validators
(Luhn, IBAN mod-97, Verhoeff, ABA, SSN, BIC) rather than regex alone. This recipe wraps it as a
`rules.custom` guardrail in three lines of real logic — scan, decide, redact — so the same engine
that writes your audit trail also gates the wire.

## Run it

```bash
cd recipes/governance/pii-guardrail
npm install
node index.mjs
```

## Expected output

```text
REDACTED before send: provider received "email <redacted> the invoice"

guardrail_decision entries in the audit chain:
  redact input  pii  pii: email

chain verifies: true  (the email never left the process in the clear)

A guardrail that pastes the raw address into its own reason:
  reason as written : "pii: email alice@example.com"
  reason on disk    : "pii: email <redacted>"
  address on disk   : false  <- AuditLog redacts on write
```

## The last three lines are the interesting ones

The obvious assertion to write here is *"the raw address is not in the audit chain"*. **Measured
2026-08-01: that assertion can never fail** — `AuditLog` runs its own redactor on the way in, so even
a badly-written guardrail that pastes a raw address into its `reason` cannot turn the audit trail
into a second copy of the leak.

A check that cannot fail is not a check. So rather than assert it, the recipe **demonstrates** it:
it installs a deliberately-leaky verdict and prints what actually lands on disk. Defence in depth,
shown rather than claimed.

## Honest limits

⚠️ **Parity note.** The regex + validator catalogue is **identical** to Python. What differs is the
optional NER layer: Python uses **Presidio** (spaCy transformer models); TypeScript uses the optional
**`compromise`** peer, which is English-only, synchronous, and has **lower recall** on free-text
names, places and organizations.

It is a useful extra layer, **not a sufficient sole PII control** — in either language. A transformer
NER would match Presidio's quality but is asynchronous, which cannot satisfy acttrace's synchronous,
tamper-evident append path. See the
[parity matrix](https://github.com/cendorhq/cendor-libs-js/blob/main/docs/parity.md).

No detection catalogue catches everything. Treat this as a strong floor, not a guarantee.

Python twin: [`governance/pii-guardrail`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/governance/pii-guardrail) ·
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
