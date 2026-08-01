# acttrace (JS) — a tamper-evident record of what your agent did

**The pain.** "Prove what the agent saw and decided" is a real question from compliance, from
security, and from your own future self at 2 a.m. A log file answers the first half and cannot answer
the second at all: nothing about a JSONL file says it was not edited afterwards.

**What this shows.** `@cendor/acttrace` hash-chains every event — each entry commits to the one before
it — and optionally HMAC-signs them. `verify()` re-walks the chain and reports the **exact sequence
number** where it breaks. This recipe flips a single byte inside a hashed payload and watches it fail.

## Run it

```bash
cd recipes/quickstarts/acttrace
npm install
node index.mjs
```

## Expected output

```text
verify: true  (ok: 5 entries, head aec5b1642224… (signatures verified; metadata signature verified))
(1 byte flipped)
verify: false  (tampered entry at seq 1: hash mismatch)
```

One byte. Lowercase `q` to uppercase `Q`, inside the recorded decision input — and the chain names the
entry it broke at.

## Core concepts

| piece | what it does |
|---|---|
| `new AuditLog(system, { riskTier, path, signingKey })` | the chain; auto-subscribes to core's bus |
| `audit.decision(cb, { input, actor })` | group a unit of work — everything inside is tagged with it |
| `d.record({ ... })` | decision metadata (model, prompt id, whatever you must be able to show) |
| `d.humanOversight(reviewer, action, note)` | an Art. 14-style human-in-the-loop event |
| `audit.export(path, framework)` | an evidence pack, annotated for a named framework |
| `verify(path, { key })` | `[ok, detail]` — re-walks hashes and signatures |

## The shape that differs from Python

⚠️ **`decision` takes the CALLBACK FIRST**: `audit.decision(cb, { input, actor })`.

Python opens a decision as a context manager (`with audit.decision(input=…) as d1:`). TypeScript has
no `with`, so the scope is expressed as a callback — and because the options must follow it, the
argument order is *inverted* relative to what a Python reader expects. Everything the callback does
runs inside the decision's `AsyncLocalStorage` scope, so auto-captured LLM calls are tagged with it
without being passed anything.

`humanOversight` / `riskTier` / `signingKey` are camelCase; the **JSON written to the chain keeps
snake_case keys**, because a Python `verify()` must be able to read a TypeScript-written chain.

## Honest limits

⚠️ **acttrace produces evidence to support a compliance case. It is not a compliance guarantee**, and
`framework: 'eu_ai_act'` annotates entries with article references — it does not certify anything.

The hash chain proves **integrity**, not authenticity, unless you sign it: without `signingKey`,
anyone who can rewrite the file can also recompute the chain. With it, they would need the key. Load
that key from your secret manager — the `demo-signing-key` fallback here exists so the recipe is green
out of the box and is not a pattern to copy.

Detach before you read: `audit.detach()` flushes and closes the file. Reading it while the log is
still attached can see a partial last line.

Python twin: [`quickstarts/acttrace`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/quickstarts/acttrace) ·
Packages: `@cendor/acttrace` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/acttrace  ^3.1.0
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
