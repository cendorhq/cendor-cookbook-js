# claude-agent-pretooluse (JS) — a cendor Guardrail as a Claude Agent SDK `PreToolUse` hook

**The pain.** The Claude Agent SDK fires `PreToolUse` before every tool call and expects its own
`permissionDecision` shape back. Your policy lives in cendor. Without a bridge, you write it twice.

**What this shows.** A cendor `block` becomes `permissionDecision: "deny"`; the reason rides
`permissionDecisionReason`, so the agent is told *why*.

## What a "bridge" is here

A bridge maps a cendor guardrail onto a framework's own interception point. The **policy** stays in
cendor, so one rule set governs a raw client, this framework, and a `@cendor/sdk` run — and you do
not maintain three copies of it that drift.

The framework *works alongside* Cendor. Nothing is patched, and this is not an official integration.

## Run it

```bash
cd recipes/bridges/claude-agent-pretooluse
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
allow  "curl https://api.example.com/data"
deny   "curl http://evil.example.com/steal"
       -> cendor guardrail: guardrail "url_deny" blocked at stage "tool_call": URL host denied: evil.example.com
```

⚠️ An empty `{}` means **allow**, so a hook that mapped nothing would return `{}` every time and
print a perfectly plausible first line. Both directions are asserted.

## The shape that differs from Python — and it is the whole port

⚠️ **`HookMatcher`, `HookContext` and `ClaudeAgentOptions` are TYPES in the TypeScript SDK**, erased
at runtime. There are no classes to construct. Python writes:

```python
options = ClaudeAgentOptions(hooks={"PreToolUse": [HookMatcher(hooks=[hook])]})
out = await hook(call, "tool-use-1", HookContext(signal=None))
```

TypeScript writes plain object literals:

```js
const options = { hooks: { PreToolUse: [{ hooks: [hook] }] } };
const out = await hook(call, 'tool-use-1', { signal: undefined });
```

`HOOK_EVENTS` is one of the few runtime values, and the recipe asserts `'PreToolUse'` is still in it
— so an SDK that renamed the event fails here rather than silently never firing.

## Honest limits

The hook gates the tool's **arguments**. It cannot see what the tool would do, only what it was
asked to do.

Python twin: [`bridges/claude-agent-pretooluse`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/bridges/claude-agent-pretooluse) ·
Packages: `@cendor/guardrails`, `@anthropic-ai/claude-agent-sdk` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/guardrails              ^3.1.0
@anthropic-ai/claude-agent-sdk  ^0.3.220
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
