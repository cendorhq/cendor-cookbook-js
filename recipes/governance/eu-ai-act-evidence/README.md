# eu-ai-act-evidence (JS) — a tamper-evident evidence pack for a high-risk decision

**The pain.** A regulator — or your own compliance team — asks: *what did the agent see, what did it
decide, what did it **refuse**, and can you prove the record was not edited afterwards?* A log file
answers the first three. Nothing about a JSONL file answers the fourth.

**What this shows.** A signed, hash-chained evidence pack containing **both** a decision the model
made and a decision the policy refused — exported with framework annotations, verified through the
CLI, then broken by a single flipped byte.

## Run it

```bash
cd recipes/governance/eu-ai-act-evidence
npm install
node index.mjs
```

## Expected output

```text
SSN-bearing prompt blocked pre-flight : true (refusal recorded)
refusal is inside the evidence pack   : true
$ acttrace verify evidence.jsonl --key ***
ok: 9 entries, head b9f7ebcff980… (signatures verified; metadata signature verified)
  exit 0
tampered entry at seq 7: hash mismatch
$ acttrace verify evidence.jsonl --key ***   (1 byte flipped)
  exit 1
```

## The refusal is the part most implementations get wrong

A system that logs only what it **did** produces an evidence trail in which *a blocked request is
indistinguishable from a request nobody ever made*. The refusal has to be a first-class record, so
this recipe reads the exported pack back and asserts the `policy_flag` is in there.

**And the guard runs on the `instrument()` seam**, before the request leaves. That matters twice: a
refusal costs $0, and the model provably never saw the SSN. A check inside your handler is too late
in both directions — the data has already gone, and the log says "we sent it, then complained".

⚠️ `addInterceptor` is **process-global**, which is why the `finally` in this recipe is not optional.
Leave it installed and every later call in the process is silently gated by it.

## The tamper demo is deliberately subtle

One byte, inside a payload that is hashed into the chain — not a deleted line, not a reordered file.
A chain that only caught coarse edits would not be worth much. `verify` names the sequence number.

## The shape that differs from Python

⚠️ **`audit.decision(cb, opts)` takes the CALLBACK FIRST.** Python opens a decision as a context
manager (`with audit.decision(input=…) as d:`); TypeScript has no `with`, so the scope is a callback
and the options follow it — the argument order is *inverted* from what a Python reader expects.

## Honest limits

⚠️ **acttrace produces evidence to support a compliance case. It is not a compliance guarantee.**
`framework: 'eu_ai_act'` annotates entries with article references; it certifies nothing, and **no
article is satisfied by a log alone**.

The chain proves **integrity**. It proves **authenticity** only if you sign it — without a
`signingKey`, anyone who can rewrite the file can recompute the chain. The `demo-signing-key`
fallback here exists so the recipe is green out of the box; load yours from a secret manager.

Python twin: [`governance/eu-ai-act-evidence`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/governance/eu-ai-act-evidence) ·
Packages: `@cendor/acttrace`, `@cendor/core` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/acttrace  ^3.1.0
@cendor/core      ^3.4.0
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
