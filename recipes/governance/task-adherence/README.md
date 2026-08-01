# task-adherence (JS) — is this tool call on-task? (a BYO-judge alignment check)

**The pain.** Agents drift. The user asks to *book a flight to Paris*; a few turns later the model
proposes `delete_account(...)`. **Content filters do not catch this** — the call is not unsafe, it is
just not what anyone asked for. That is an alignment question, and it needs the original instruction
to answer.

**What this shows.** `judge.taskAdherence(respond)` compares a proposed tool call against the run's
originating instruction, using a model you supply — and like every judge here, that model is
instrumented, so the alignment check's own spend is measured.

## Run it

```bash
cd recipes/governance/task-adherence
npm install
node index.mjs
```

## Expected output

```text
aligned   -> aligned
off-task  -> flagged: off-task: unrelated to booking a flight

the alignment judge's own spend is budgeted + attributed (2 call(s), 144 tokens) — the safety check
is itself measured. No adherence-rate claim: it is a BYO judge, only as good as its model + prompt.
```

**Both lines are asserted, and both matter.** A rail that flagged everything would satisfy the
second on its own — and an agent that cannot call any tool is not aligned, it is broken.

## The shapes that differ from Python

⚠️ **`Context` is a plain OBJECT, not a class.** Python constructs
`Context(stage=…, tool=…, tool_args=…, instruction=…)`; TypeScript takes an object literal with
**camelCase** keys — `{ stage, tool, toolArgs, instruction }`.

⚠️ **`evaluateAsync` returns `{ payload, decisions }`**, not a `(cleaned, decisions)` tuple. And it
must be the **async** seam, because the judge awaits a model call.

## Where `instruction` comes from

Under `@cendor/sdk` (≥ 0.7.0) the runner threads the user's turn into `ctx.instruction`
automatically. Standalone — as here — you set it yourself. Without it, `taskAdherence` has nothing to
compare against and cannot tell drift from ordinary work.

## Honest limits

**No adherence-rate claim.** This is a BYO judge: its quality is entirely your model's and your
prompt's. It is also attackable in the same way as any judge — it reads text the agent produced.

Treat a flag as a **signal to a human or a cheaper deterministic check**, not as a verdict. The
recipe uses `action: 'flag'` rather than `'block'` for exactly that reason.

Python twin: [`governance/task-adherence`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/governance/task-adherence) ·
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
