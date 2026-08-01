# guardrails (JS) — block, redact, and record before the model call

**The pain.** Two things must happen *before* the request reaches the wire, and most tooling does
neither: a prompt-injection attempt should be refused so it never becomes a paid call, and a leaked
API key should be scrubbed so the provider never receives it. Catching either one in a response log
is too late — the money is spent and the secret is gone.

**What this shows.** `@cendor/guardrails` gates at the `input` stage, inside the same interceptor
chain `instrument()` installs. A `block` raises before the request is sent; a `redact` rewrites the
payload in flight. Every decision lands in a tamper-evident `@cendor/acttrace` chain that `verify()`
can re-walk.

## Run it

```bash
cd recipes/quickstarts/guardrails
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
BLOCKED by keyword_deny (input): denied keyword: "ignore previous instructions"
  provider calls so far: 0  =>  $0.00 spent on it

REDACTED before send: provider received "my key is [redacted]"

guardrail_decision entries in the audit chain:
  block  input  keyword_deny
  redact input  regex_rule

chain verifies: true  (the blocked prompt spent $0.00 - the model never saw it)
```

## Core concepts

| piece | what it does |
|---|---|
| `install([...rails])` | attach guardrails to the interceptor chain; `uninstall()` detaches |
| `rules.keywordDeny(words, { action: 'block' })` | literal match → refuse before the wire |
| `rules.regexRule(re, { action: 'redact', stage: 'input' })` | rewrite the payload in flight |
| `GuardrailTripped` | thrown on `block`; `err.decisions` carries what fired and why |
| `new AuditLog(system, { path })` | auto-subscribes; every decision is hash-chained |
| `verify(path)` | `[ok, detail]` — re-walks the chain |

## The one thing this recipe is really about: which layer you check

⚠️ **`sent` is read out of the fake provider's own record** — the object the client was actually
handed. That is the only place a redaction claim can honestly be tested.

A probe that inspects the **caller's** arguments instead sits *above* the interceptor chain, sees the
raw key, and reports a working redaction as a leak. That exact mistake cost a full review round on
2026-07-31. If you write your own redaction test, spy **under** the wrapper, at the transport.

## The shapes that differ from Python

⚠️ **`install()` / `uninstall()` are process-global**, so the `finally` block matters — a recipe that
throws mid-way would otherwise leave rails attached for anything that runs after it.

⚠️ **Rule names are camelCase** (`keywordDeny`, `regexRule`), but the **decision payload keeps
snake_case wire keys** (`e.payload.guardrail`, `e.payload.stage`) because that JSON is shared with
Python. `action` is narrowed to a union type, so `'redcat'` is a compile error.

⚠️ **`AuditLog` takes the system name positionally**: `new AuditLog('assistant', { path })`. Call
`detach()` before reading the file — it flushes and closes.

## Honest limits

`keywordDeny` is **literal** matching. It blocks what it was told to block and sails past a
paraphrase — that is the point of the separate `governance/custom-category` recipe, which catches by
meaning instead. Neither is a jailbreak-proof filter, and no catch-rate is claimed here.

`acttrace` produces **evidence to support** a compliance case. It proves the record was not edited
after the fact; it does not certify that your policy was adequate.

Python twin: [`quickstarts/guardrails`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/quickstarts/guardrails) ·
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
