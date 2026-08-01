/**
 * @cendor/sdk governed agent (JS) — a budget-capped, audited agent with one tool call, fully offline.
 *
 * Governance is the foundation, not a plugin: withBudget() is a real circuit breaker (pre-flight
 * block), AuditLog writes a tamper-evident chain that verify() checks, and the whole run stays on
 * @cendor/core's bus. No key, no network — a stub OpenAI-shaped client stands in for the provider.
 *
 * Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, AuditLog, run, tool, verify, withBudget } from '@cendor/sdk';
import { z } from 'zod';

/**
 * The offline provider. Two turns, because that is the minimum an agent loop needs to be an agent
 * loop: the model asks for a tool, the SDK runs it, and the model answers with the result in hand.
 * A one-turn stub would let a broken tool loop pass.
 *
 * ⚠️ Nothing here is cendor-shaped — it is the OpenAI wire shape, exactly. `instrument()` (which the
 * SDK applies for you) identifies a client by its SHAPE, so a real app swaps in
 * `client: new OpenAI()` and changes nothing else. The `usage` numbers are what gets priced, so
 * they have to be present and plausible or the budget below would have nothing to enforce against.
 */
function stubClient(answer) {
  let calls = 0;
  return {
    chat: {
      completions: {
        // The tool-call turn. `finish_reason: 'tool_calls'` is what tells the loop to keep going;
        // `params.tools` is the guard that stops the follow-up turn re-requesting the same tool.
        create: async (params) => {
          if (calls++ === 0 && params.tools) {
            return {
              choices: [
                {
                  finish_reason: 'tool_calls',
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'refund', arguments: JSON.stringify({ orderId: '123' }) },
                      },
                    ],
                  },
                },
              ],
              usage: { prompt_tokens: 60, completion_tokens: 12 },
            };
          }
          // The final turn: `finish_reason: 'stop'` ends the loop.
          return {
            choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: answer } }],
            usage: { prompt_tokens: 90, completion_tokens: 20 },
          };
        },
      },
    },
  };
}

const refund = tool((a) => `refunded order ${a.orderId}`, {
  name: 'refund',
  description: 'Issue a refund for an order id',
  parameters: z.object({ orderId: z.string() }),
});

const dir = mkdtempSync(join(tmpdir(), 'cendor-recipe-'));
const auditPath = join(dir, 'audit.jsonl');
const audit = new AuditLog('refund-bot', {
  riskTier: 'high',
  path: auditPath,
  signingKey: 'demo-key',
});

const agent = new Agent({
  name: 'refund-bot',
  model: 'gpt-4o',
  instructions: 'Help the user with refunds. Use the refund tool when appropriate.',
  tools: [refund],
  client: stubClient('Done — your refund for order 123 is on the way.'),
});

const result = await withBudget({ usd: 0.5, onExceed: 'block' }, () =>
  run(agent, 'I want a refund for order 123', { audit }),
);
audit.detach();
assert.ok(result, 'the governed run produced no result');

console.log('output :', result.output);
console.log('cost   :', result.cost.toString());
console.log('tokens :', result.usage.totalTokens);
console.log(
  'tools  :',
  result.toolSteps.map((s) => s.name),
);
console.log('trace  :', result.traceId);
const [ok, detail] = verify(auditPath, { key: 'demo-key' });
console.log('audit  :', ok, '—', detail);

// The recipe IS the test. Without these, an SDK that silently stopped running the tool, stopped
// pricing the run, or stopped writing the chain would print a perfectly plausible block of output
// and exit 0 — which is exactly the failure a cookbook is supposed to catch.
assert.equal(result.toolSteps.length, 1, 'the agent did not run its one tool');
assert.equal(result.toolSteps[0].name, 'refund');
// `Result.output` is `unknown` — an agent configured with an `outputType` returns the PARSED
// object, not text. This one has no outputType, so it is the model's string.
assert.ok(
  typeof result.output === 'string' && result.output.length > 0,
  'the agent produced no final answer',
);
// Money is decimal.js, never a float — `.amount.gt(0)`, not `Number(...) > 0`.
// ⚠️ `result.cost` is a `Money`, and `Money.gt()` compares against another `Money`: pass it a
// number and it fails `currency mismatch: USD vs undefined`, which reads like a bug in your
// pricing rather than in your assertion. The Decimal lives on `.amount`.
assert.ok(result.cost.amount.gt(0), 'the governed run was not priced');
assert.ok(result.usage.totalTokens > 0, 'usage did not reach the result');
assert.ok(result.traceId, 'the run carried no trace id');
assert.equal(ok, true, `the audit chain failed verify(): ${detail}`);
// ⚠️ A quoted chain HEAD is per-run — entries carry timestamps, so the hash changes every time.
// The entry COUNT and verify() reproduce; the hash does not. Assert the reproducible half.
assert.ok(/ok: [0-9]+ entries/.test(detail), `unexpected verify() detail: ${detail}`);
console.log('\nOK — one tool call, priced, capped, and provably recorded.');
