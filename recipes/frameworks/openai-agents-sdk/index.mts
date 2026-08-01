/**
 * openai-agents-sdk (JS) — govern an OpenAI Agents SDK run, and know WHICH agent spent it.
 *
 * The Agents SDK hands work between named agents. Without knowing which one is running, a spend
 * report says "$4.10 on gpt-4o" — true, and useless for deciding what to fix.
 *
 * `observeOpenAIAgents(target)` subscribes to the SDK's own lifecycle events and keeps the active
 * agent name in scope, so every `LLMCall` core normalizes is attributed to the agent that made it.
 * The underlying client is instrumented as usual — the adapter adds identity, not capture.
 *
 * The Agents SDK *works alongside* Cendor. It is not an official integration.
 *
 * Offline: a fake instrumented client + the SDK's real event-target contract. No key, no network.
 * Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuditLog, verify } from '@cendor/acttrace';
import { LLMCall, bus, instrument } from '@cendor/core';
import { observeOpenAIAgents } from '@cendor/core/openai-agents';
import { reset } from '@cendor/tokenguard';

const MODEL = 'gpt-4o';

/** A minimal event target with the SDK's `on`/`off` shape — what `Runner` exposes. */
function fakeRunner() {
  type Listener = (...args: any[]) => void;
  const handlers = new Map<string, Set<Listener>>();
  return {
    on: (name: string, fn: Listener) => {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)?.add(fn);
    },
    off: (name: string, fn: Listener) => handlers.get(name)?.delete(fn),
    emit: (name: string, ...args: unknown[]) => {
      for (const fn of handlers.get(name) ?? []) fn(...args);
    },
  };
}

function fakeClient(usage: { prompt_tokens: number; completion_tokens: number }) {
  return instrument({
    chat: {
      completions: {
        create: async (_req: { model: string; messages: { role: string; content: string }[] }) => ({
          choices: [{ message: { content: 'done' } }],
          usage,
          model: MODEL,
        }),
      },
    },
  });
}

reset();
bus._reset();
const calls: LLMCall[] = [];
bus.subscribe((e: unknown) => {
  if (e instanceof LLMCall) calls.push(e);
});

const chain = join(mkdtempSync(join(tmpdir(), 'cendor-agents-')), 'audit.jsonl');
const audit = new AuditLog('agents-run', { riskTier: 'limited', path: chain });

const runner = fakeRunner();
// The whole integration: one subscription. It returns an unsubscribe — call it, or the runner keeps
// stamping agent identity onto every later call in the process.
const stop = observeOpenAIAgents(runner);

try {
  // The triage agent answers cheaply...
  runner.emit('agent_start', undefined, { name: 'triage' });
  await fakeClient({ prompt_tokens: 900, completion_tokens: 60 }).chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: 'route this ticket' }],
  });
  runner.emit('agent_end', undefined, { name: 'triage' });

  // ...then hands off to the expensive one, which is the thing you want to see in the report.
  runner.emit('agent_start', undefined, { name: 'refund-specialist' });
  await fakeClient({ prompt_tokens: 14_000, completion_tokens: 1_800 }).chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: 'resolve the duplicate charge' }],
  });
  runner.emit('agent_end', undefined, { name: 'refund-specialist' });
} finally {
  stop();
  audit.detach();
}

// ⚠️ THE SHAPE THAT SURPRISES PEOPLE: the agent name is an AMBIENT attribute, so it lands on
// `call.metadata.agent` — NOT on tokenguard's grouping tags. `report(['agent'])` returns
// `{ agent: null }`, because `report` groups by `track()` tags and nothing here tagged an agent.
// Measured while writing this recipe.
//
// That is the right design: the identity travels with the CALL (into the audit chain and any OTel
// span) rather than requiring every call site to remember to tag itself. You aggregate from the
// bus — three lines, and exact.
const spendByAgent = new Map();
for (const c of calls) {
  const agent = c.metadata.agent ?? '(none)';
  const prev = spendByAgent.get(agent) ?? { calls: 0, tokens: 0, usd: null };
  spendByAgent.set(agent, {
    calls: prev.calls + 1,
    tokens: prev.tokens + (c.usage?.totalTokens ?? 0),
    usd: c.cost === null ? prev.usd : (prev.usd?.plus(c.cost.amount) ?? c.cost.amount),
  });
}

console.log('spend by AGENT, not just by model:');
for (const [agent, row] of spendByAgent) {
  console.log(`  ${agent.padEnd(18)} ${row.calls} call  ${row.tokens} tok  $${row.usd.toString()}`);
}

const [ok, detail] = verify(chain);
console.log(`\nverify() : ${ok} - ${detail}`);

assert.equal(calls.length, 2, `both agent calls should reach the bus, got ${calls.length}`);
// Identity is the entire point. An aggregation that collapsed both calls into one row would print
// a perfectly plausible total and answer nothing.
assert.equal(spendByAgent.size, 2, `expected one row per agent, got ${spendByAgent.size}`);
assert.ok(spendByAgent.has('triage'), 'the triage agent was not attributed');
assert.ok(spendByAgent.has('refund-specialist'), 'the refund-specialist agent was not attributed');
assert.ok(
  spendByAgent.get('refund-specialist').usd.gt(spendByAgent.get('triage').usd),
  'the expensive agent did not out-spend the cheap one — attribution is crossed',
);
assert.equal(ok, true, 'the audit chain failed verify()');

console.log(
  '\n⚠️ `observeOpenAIAgents` adds IDENTITY, not capture — the client is still instrumented the ' +
    'usual way. And it returns an unsubscribe: leave it attached and every later call in the ' +
    'process keeps the last agent name. The Agents SDK works ALONGSIDE Cendor; nothing is patched.',
);
