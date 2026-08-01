# openai-agents-sdk (JS) — govern an Agents run, and know WHICH agent spent it

**The pain.** The Agents SDK hands work between named agents. Without knowing which one is running,
your spend report says *"$4.10 on gpt-4o"* — true, and useless for deciding what to fix.

**What this shows.** `observeOpenAIAgents(target)` subscribes to the SDK's own lifecycle events and
keeps the active agent name in scope, so every `LLMCall` core normalizes is attributed to the agent
that made it.

The Agents SDK *works alongside* Cendor. It is not an official integration.

## Run it

```bash
cd recipes/frameworks/openai-agents-sdk
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
spend by AGENT, not just by model:
  triage             1 call  960 tok  $0.00285
  refund-specialist  1 call  15800 tok  $0.053

verify() : true - ok: 3 entries, head 0c0e1210c720…
```

One model, one price table, **18× the cost** — and now you know where it went.

## ⚠️ The shape that surprises people

The agent name is an **ambient** attribute, so it lands on **`call.metadata.agent`** — *not* on
tokenguard's grouping tags. `report(['agent'])` returns `{ agent: null }`, because `report` groups
by `track()` tags and nothing here tagged an agent. **Measured while writing this recipe.**

That is the right design: the identity travels with the **call** — into the audit chain and any OTel
span — rather than requiring every call site to remember to tag itself. You aggregate from the bus,
which is three lines and exact (see `index.mjs`). If you *want* it in `report()`, wrap the run in
`track({ agent: name })` yourself.

## Two more things worth knowing

⚠️ **`observeOpenAIAgents` adds IDENTITY, not capture.** The client is still instrumented the usual
way; the adapter only supplies the name.

⚠️ **It returns an unsubscribe — call it.** Leave it attached and every later call in the process
keeps the last agent name, long after the run ended.

## Honest limits

The name comes from the SDK's `agent_start` / `agent_handoff` / `agent_end` events. An agent that
never emits them is attributed to whatever was active last — which is why the disposer matters.

Python twin: [`frameworks/openai-agents-sdk`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/frameworks/openai-agents-sdk) ·
Packages: `@cendor/acttrace`, `@cendor/core`, `@cendor/tokenguard`, `@openai/agents` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/core        ^3.4.0
@cendor/tokenguard  ^3.1.0
@cendor/acttrace    ^3.1.0
@openai/agents      ^0.14.2
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
