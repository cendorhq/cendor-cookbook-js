# mcp-tool-gating (JS) — gate an MCP tool's arguments with a cendor Guardrail

**The pain.** An MCP server exposes tools to any client that connects. "Should this tool run?" is a
policy question, and it has to be answered with the **arguments in hand** — not at the model call,
and not after the side effect.

**What this shows.** cendor's `tool_call` stage wrapping a tool handler. A block returns an MCP tool
**result the model can see** (`[blocked …]`) instead of executing.

## What a "bridge" is here

A bridge maps a cendor guardrail onto a framework's own interception point. The **policy** stays in
cendor, so one rule set governs a raw client, this framework, and a `@cendor/sdk` run — and you do
not maintain three copies of it that drift.

The framework *works alongside* Cendor. Nothing is patched, and this is not an official integration.

## Run it

```bash
cd recipes/bridges/mcp-tool-gating
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
"ls -la"       -> ran: ls -la
"rm -rf /"     -> [blocked by guardrail] guardrail "keyword_deny" blocked at stage "tool_call": denied keyword: "rm -rf"
```

## Why a result and not an exception

A blocked tool returns a **result**, so the model reads "you were refused" and can re-plan. An
exception looks to the model like the tool *crashed*, which invites a retry of the same call. This
mirrors how `@cendor/sdk` handles a tool-stage block.

## The assertion that matters

The recipe asserts the **body did not run**, not just that the text says blocked:

```js
assert.ok(!results['rm -rf /'].includes('ran:'), 'the tool body executed despite the block');
```

A gate that returned the block string *and* still executed the tool would print an identical line
for the safe command, and the obvious assertion would pass.

## The shape that differs from Python

⚠️ **No decorators.** Python stacks `@gated(...)` above `@mcp.tool()`; here `gated(...)` is a
higher-order function applied at registration. The tool is registered on a real `McpServer` with
`registerTool(name, config, handler)`.

## Honest limits

This gates **arguments**, which is the right place for a denylist. It cannot judge intent — a
dangerous command spelled differently sails through. Layer a semantic or judge-backed rail behind it
(see [`governance/task-adherence`](../../governance/task-adherence/README.md)).

Python twin: [`bridges/mcp-tool-gating`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/bridges/mcp-tool-gating) ·
Packages: `@cendor/guardrails`, `@modelcontextprotocol/sdk`, `zod` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/guardrails         ^3.1.0
@modelcontextprotocol/sdk  ^1.30.0
zod                        ^4.1.13
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
