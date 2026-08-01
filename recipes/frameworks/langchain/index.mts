/**
 * langchain (JS) — govern a LangChain run without changing the chain.
 *
 * LangChain already has a callback system, so Cendor does not need to patch anything: attach
 * `CendorCallbackHandler` and every LLM call LangChain makes lands on core's bus as a normalized
 * `LLMCall` — priced, budgeted, and chained into an audit trail like any other call.
 *
 * That means the agent code stays exactly as it was. Governance is a handler you attach, and the
 * *same* budget and audit chain cover a raw client, a LangChain chain, and a `@cendor/sdk` run.
 *
 * LangChain *works alongside* Cendor. It is not an official integration.
 *
 * Offline: a fake chat model with LangChain's own callback contract. No key, no network.
 * Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuditLog, verify } from '@cendor/acttrace';
import { LLMCall, bus } from '@cendor/core';
import { CendorCallbackHandler } from '@cendor/core/langchain';
import { report, reset, track } from '@cendor/tokenguard';

const MODEL = 'gpt-4o';

/**
 * A stand-in for a LangChain chat model, driving the handler through LangChain's own callback
 * contract: `handleLLMStart` → `handleLLMEnd`. A real `ChatOpenAI` calls exactly these, which is why
 * the handler needs no knowledge of any provider.
 */
async function fakeChainRun(
  handler: CendorCallbackHandler,
  { prompt, inputTokens, outputTokens }: { prompt: string; inputTokens: number; outputTokens: number },
) {
  const runId = globalThis.crypto.randomUUID();
  await handler.handleLLMStart(
    // LangChain's `Serialized` is a discriminated union; a hand-built stand-in needs the two
    // discriminant fields or it matches no member.
    {
      lc: 1,
      type: 'constructor',
      id: ['langchain', 'chat_models', 'openai', 'ChatOpenAI'],
      kwargs: { model: MODEL },
    },
    [prompt],
    runId,
  );
  await handler.handleLLMEnd(
    {
      generations: [[{ text: 'Refunds are issued within five business days.' }]],
      llmOutput: {
        model_name: MODEL,
        tokenUsage: { promptTokens: inputTokens, completionTokens: outputTokens },
      },
    },
    runId,
  );
  return 'Refunds are issued within five business days.';
}

reset();
bus._reset();
const calls: LLMCall[] = [];
bus.subscribe((e: unknown) => {
  if (e instanceof LLMCall) calls.push(e);
});

const chain = join(mkdtempSync(join(tmpdir(), 'cendor-langchain-')), 'audit.jsonl');
const audit = new AuditLog('support-chain', { riskTier: 'limited', path: chain });

// The whole integration: one handler. Pass it as `callbacks: [handler]` to any LangChain runnable.
const handler = new CendorCallbackHandler();

try {
  await track({ feature: 'refund-faq' }, async () => {
    await fakeChainRun(handler, { prompt: 'How are duplicate charges refunded?', inputTokens: 1400, outputTokens: 180 });
    await fakeChainRun(handler, { prompt: 'And for a failed payment?', inputTokens: 900, outputTokens: 120 });
  });
} finally {
  audit.detach();
}

const r = report(['feature']);
const [ok, detail] = verify(chain);
const audited = audit.entries.filter((e) => e.type === 'llm_call');

console.log(`langchain calls captured : ${calls.length} (attach one handler; change nothing else)`);
console.log(`model / provider         : ${calls[0].model} / ${calls[0].provider}`);
assert.ok(calls[0]?.usage, 'the LangChain call reached the bus without normalized usage');
console.log(`usage                    : ${calls[0].usage.inputTokens} in + ${calls[0].usage.outputTokens} out`);
console.log(`spend by feature         : ${r.rows[0].calls} calls  $${r.rows[0].usd.amount.toString()}`);
console.log(`audit entries chained    : ${audited.length} llm_call`);
console.log(`verify()                 : ${ok} - ${detail}`);

assert.equal(calls.length, 2, `both chain runs should reach the bus, got ${calls.length}`);
assert.equal(calls[0].usage?.inputTokens, 1400, "LangChain's tokenUsage was not normalized");
assert.ok(calls[0].cost?.amount.gt(0), 'the LangChain call reached the bus unpriced');
assert.equal(r.rows[0].calls, 2, 'tokenguard did not attribute the LangChain calls');
assert.equal(audited.length, 2, 'the LangChain calls were not chained into the audit trail');
assert.equal(ok, true, 'the audit chain failed verify()');

console.log(
  '\n⚠️ `tokenUsage` is camelCase in langchain-js and `token_usage` in Python LangChain — the ' +
    'handler reads both, so nothing in your code changes. LangChain works ALONGSIDE Cendor; ' +
    'nothing is patched and this is not an official integration.',
);
