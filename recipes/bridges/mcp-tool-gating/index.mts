/**
 * Bridge: gate an MCP tool's arguments with a cendor Guardrail (JS).
 *
 * An MCP server exposes tools to any client that connects. cendor's `tool_call` stage is the
 * intervention point for "should this tool run with THESE arguments?", so the same guardrail that
 * gates a model call gates a tool call — one policy, every surface.
 *
 * A cendor `block` returns an MCP tool result the model can SEE (`[blocked …]`) instead of
 * executing, mirroring how `@cendor/sdk` handles a tool-stage block. The model learns it was
 * refused, which is what lets it re-plan.
 *
 * Offline: the gated handler is called directly — no MCP transport, no client, no network.
 * Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';

import { type Guardrail, GuardrailTripped, apply, rules, type Stage } from '@cendor/guardrails';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const server = new McpServer({ name: 'demo', version: '1.0.0' });

/**
 * Wrap a tool handler so `guardrails` run over its arguments before the body.
 *
 * ⚠️ The shape differs from Python: there are no decorators, so this is a higher-order function
 * applied at registration rather than `@gated(...)` stacked above `@mcp.tool()`.
 */
/** An MCP tool result: the `content` array the protocol returns to the model. */
// `type` is the LITERAL 'text', not `string` — the MCP SDK's content union is discriminated on
// it, so a widened `string` is rejected at the registration call.
type ToolResult = { content: { type: 'text'; text: string }[] };
type ToolArgs = Record<string, unknown>;

function gated(
  guardrails: Guardrail[],
  handler: (args: ToolArgs) => Promise<ToolResult>,
  { stage = 'tool_call' }: { stage?: Stage } = {},
) {
  return async (args: ToolArgs): Promise<ToolResult> => {
    try {
      apply(guardrails, stage, JSON.stringify(args)); // throws GuardrailTripped on a block
    } catch (err) {
      if (!(err instanceof GuardrailTripped)) throw err;
      return { content: [{ type: 'text', text: `[blocked by guardrail] ${err.message}` }] };
    }
    return handler(args);
  };
}

const runShellBody = async ({ command }: ToolArgs): Promise<ToolResult> => ({
  content: [{ type: 'text', text: `ran: ${command}` }],
});

const runShell = gated(
  [rules.keywordDeny(['rm -rf', 'mkfs'], { action: 'block', stage: 'tool_call' })],
  runShellBody,
);

// Registered on a real McpServer — this is the production wiring, exercised offline below.
server.registerTool(
  'run_shell',
  { description: 'Run a shell command (guarded).', inputSchema: { command: z.string() } },
  runShell,
);

const results: Record<string, string> = {};
for (const command of ['ls -la', 'rm -rf /']) {
  const result = await runShell({ command });
  const text = result.content[0].text;
  results[command] = text;
  console.log(`${JSON.stringify(command).padEnd(14)} -> ${text}`);
}

// Assert on the BODY NOT RUNNING, not just on the text: a gate that returned the block string and
// still executed the tool would print exactly the same line for the safe command.
assert.equal(results['ls -la'], 'ran: ls -la', 'the safe command did not reach the tool body');
assert.ok(results['rm -rf /'].startsWith('[blocked by guardrail]'), 'the dangerous command ran');
assert.ok(!results['rm -rf /'].includes('ran:'), 'the tool body executed despite the block');

console.log(
  '\nA blocked tool returns a RESULT the model can read, not an exception — so the agent learns it ' +
    'was refused and can re-plan. An exception here would look to the model like the tool crashed.',
);
