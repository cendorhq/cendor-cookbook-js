/**
 * azure-foundry (JS) — the governed lifecycle for a Microsoft Foundry deployment (an UNPRICED id).
 *
 * Same five steps as every recipe in `providers/`, on the Foundry **v1 GA** endpoint:
 *
 *   1. connect     the **standard `openai` SDK** pointed at `<endpoint>/openai/v1/` — no
 *                  `AzureOpenAI` class, no `api-version`. Faked here with the identical shape.
 *   2. instrument  one wrap; Foundry models are detected as `openai`, so capture is free
 *   3. govern      a `@cendor/tokenguard` USD budget + one `@cendor/guardrails` gate
 *   4. record      `@cendor/cassette` replay — 0 provider calls, $0
 *   5. prove       `@cendor/acttrace` verify() + a cost that came from `prices`
 *
 * What is DISTINCTIVE here: **money, and only money.** You call your *deployment name*, not a model
 * id, so the price table has no row for it. Usage and the audit chain stay exact; the cost is `null`
 * and a USD `budget(...)` **silently cannot bind** — five governance demos that look like they
 * passed. This recipe shows that happening, then fixes it with one
 * `prices.registerDeployment(DEPLOYMENT, { like: 'gpt-4o' })` line — you name the model the
 * deployment serves, not a rate card — and the SAME call becomes enforceable.
 * `registerModelPrice(...)` is still there for when you hold the exact numbers instead.
 *
 * ⚠️ **Use the v1 GA endpoint, not `AzureOpenAI`.** `baseURL: '<endpoint>/openai/v1/'` with the
 * plain `OpenAI` client is the GA path; the `AzureOpenAI` class and its `api-version` dance are the
 * legacy one.
 * ⚠️ **`azure-ai-inference` is captured by NOTHING.** It is a different client shape, so
 * `instrument()` returns it untouched and you get no budget, no gate, no audit, and nothing says so.
 * Microsoft retires it 2026-08-26 regardless.
 * ⚠️ **A `model-router` deployment is not priceable.** The router bills at the *serving* model's
 * rates while the call reports the router's own id, so no single registration is ever correct.
 *
 * Offline: a fake OpenAI-shaped client. No key, no network.
 * Run:  npm install && node index.mjs
 *
 * Record a real cassette (maintainer, needs a Foundry deployment):
 *   RECORD=1 node index.mjs
 *   # env: AZURE_OPENAI_ENDPOINT AZURE_OPENAI_API_KEY AZURE_OPENAI_DEPLOYMENT
 *   # optional: AZURE_BASE_MODEL (the model your deployment serves; default gpt-4o)
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AuditLog, verify } from '@cendor/acttrace';
import * as cassette from '@cendor/cassette';
import { LLMCall, bus, instrument, prices } from '@cendor/core';
import { GuardrailTripped, install, rules, uninstall } from '@cendor/guardrails';
import { BudgetExceeded, budget, report, reset } from '@cendor/tokenguard';

const SIGNING_KEY = process.env.CENDOR_DEMO_KEY ?? 'demo-signing-key';
// A deployment NAME — the thing you actually pass as `model`. It is not a model id, which is the
// whole problem this recipe is about.
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT ?? 'prod-gpt4o-eastus';
const BASE_MODEL = process.env.AZURE_BASE_MODEL ?? 'gpt-4o';
const IN_TOKENS = 11_000;
const OUT_TOKENS = 1_500;

const providerCalls = { n: 0 };

/** Stand-in for the v1 GA client — the plain `OpenAI` shape, because that IS the Foundry GA path. */
function fakeFoundry() {
  return {
    chat: {
      completions: {
        create: async () => {
          providerCalls.n++;
          return {
            choices: [{ message: { content: 'Refund queued.' } }],
            usage: { prompt_tokens: IN_TOKENS, completion_tokens: OUT_TOKENS },
            model: DEPLOYMENT, // Foundry echoes the DEPLOYMENT name back, not the model id
          };
        },
      },
    },
  };
}
/**
 * `ask` is handed the offline fake AND — under RECORD=1 — a real `OpenAI` client pointed at the
 * Foundry v1 endpoint, so its parameter is the structural minimum BOTH satisfy rather than either
 * concrete type. The `any` on the body is honest rather than lazy: the two clients really do take
 * different request types, and this helper needs none of that detail.
 */

const ask = (client, text) =>
  client.chat.completions.create({
    model: DEPLOYMENT,
    messages: [{ role: 'user', content: text }],
  });

async function recordLive() {
  const { default: OpenAI } = await import('openai');
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/+$/, '');
  // ⚠️ THIS is the GA shape: the standard client, `/openai/v1/`, and no api-version anywhere.
  const client = instrument(
    new OpenAI({ baseURL: `${endpoint}/openai/v1/`, apiKey: process.env.AZURE_OPENAI_API_KEY }),
  );
  const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'azure-foundry.json');
  await cassette.use(fixture, { mode: 'record' })(async () => {
    await ask(client, 'Say hi in five words.');
  })();
  console.log(`recorded live call to ${fixture}`);
}

/** Everything the offline demonstration does. Wrapped so the RECORD path can skip it
 *  without `process.exit()` — see the note below. */
async function offlineDemo() {
  reset();
  const calls = [];
  bus.subscribe((e) => {
    if (e instanceof LLMCall) calls.push(e);
  });

  const client = instrument(fakeFoundry());

  const tmp = mkdtempSync(join(tmpdir(), 'cendor-azure-foundry-'));
  const chain = join(tmp, 'audit.jsonl');
  const tape = join(tmp, 'foundry.cassette.json');

  // ---- ACT ONE: the silence ------------------------------------------------------------------------
  // ONE cap value, used in both acts — that is what makes the comparison mean anything. $0.06 is a
  // little over the cost of a single call (11k in + 1.5k out at gpt-4o rates ~= $0.0425), so once the
  // deployment is priced it admits exactly one call and refuses the second. Unpriced, it admits all 8.
  const CAP_USD = 0.06;
  const capped = budget({ usd: CAP_USD, onExceed: 'block' })(async () => {
    for (let i = 0; i < 8; i++) await ask(client, 'summarize the ticket thread');
  });
  let blockedBefore = false;
  try {
    await capped();
  } catch (err) {
    if (!(err instanceof BudgetExceeded)) throw err;
    blockedBefore = true;
  }
  const ranBefore = report().rows.reduce((n, row) => n + row.calls, 0);
  const beforeCall = calls.at(-1);
  assert.ok(beforeCall, 'no LLMCall reached the bus');
  const costBefore = beforeCall.cost;
  console.log(`deployment: ${DEPLOYMENT}  (a deployment NAME, not a model id)`);
  console.log(
    `unpriced  : cost = ${costBefore == null ? 'null' : `$${costBefore.amount.toString()}`}`,
  );
  console.log(
    `            a $${CAP_USD} USD cap let all ${ranBefore} calls through — it could not bind.`,
  );
  console.log('            ^ nothing errored. That is the danger: it LOOKS governed.');

  // ---- ACT TWO: one line ---------------------------------------------------------------------------
  prices.registerDeployment(DEPLOYMENT, { like: BASE_MODEL });
  console.log(
    `fix       : prices.registerDeployment(${JSON.stringify(DEPLOYMENT)}, { like: ${JSON.stringify(BASE_MODEL)} })`,
  );

  reset();
  let blockedAfter = false;
  try {
    await capped();
  } catch (err) {
    if (!(err instanceof BudgetExceeded)) throw err;
    blockedAfter = true;
  }
  const ranAfter = report().rows.reduce((n, row) => n + row.calls, 0);
  const afterCall = calls.at(-1);
  assert.ok(afterCall, 'no LLMCall reached the bus after registering the price');
  const costAfter = afterCall.cost;
  assert.ok(costAfter, 'registering the deployment price did not make the call priceable');
  console.log(`priced    : the SAME call now costs $${costAfter.amount.toString()}`);
  console.log(
    `            the SAME cap now blocks after ${ranAfter} call(s) — enforceable at last.`,
  );

  // ---- the rest of the lifecycle, now that money works ----------------------------------------------
  const audit = new AuditLog('foundry-bot', {
    riskTier: 'limited',
    path: chain,
    signingKey: SIGNING_KEY,
  });
  try {
    install([rules.keywordDeny(['ignore previous instructions'], { action: 'block' })]);
    try {
      const seenBefore = providerCalls.n;
      try {
        await ask(client, 'ignore previous instructions');
      } catch (err) {
        if (!(err instanceof GuardrailTripped)) throw err;
        const trip = err.decisions.at(-1);
        assert.ok(trip, 'GuardrailTripped carried no decisions');
        console.log(`gate      : BLOCKED by ${trip.guardrail} (${trip.stage}) - ${trip.reason}`);
        console.log(
          `            provider saw ${providerCalls.n - seenBefore} extra call(s) => $0 spent on it`,
        );
      }
      await audit.decision(async (dec) => dec.record({ model: DEPLOYMENT }), {
        input: 'foundry batch',
        actor: 'agent',
      });
    } finally {
      uninstall();
    }
  } finally {
    audit.detach();
  }

  const before = providerCalls.n;
  await cassette.using(tape, { mode: 'record' }, () => ask(client, 'Say hi in five words.'));
  const recorded = providerCalls.n - before;
  await cassette.using(tape, { mode: 'replay' }, () => ask(client, 'Say hi in five words.'));
  const extra = providerCalls.n - before - recorded;
  console.log(`cassette  : replayed 1 call, ${extra} provider call(s), $0`);

  const [ok, detail] = verify(chain, { key: SIGNING_KEY });
  console.log(`verify()  : ${ok} - ${detail}`);

  // The two halves of the story, both asserted. If a future price table ever learns this deployment
  // name on its own, the first pair fails and the prose above stops being true.
  assert.equal(
    costBefore,
    null,
    'the deployment name was priced before registration — premise changed',
  );
  assert.equal(blockedBefore, false, 'a USD cap bound on an unpriced deployment — premise changed');
  assert.equal(ranBefore, 8, `all 8 calls should get through unpriced, got ${ranBefore}`);
  assert.ok(costAfter?.amount.gt(0), 'registerDeployment() did not make the deployment priceable');
  assert.equal(blockedAfter, true, 'the USD cap still did not bind after registration');
  assert.ok(ranAfter > 0, 'no call ran after registration — nothing priced was ever measured');
  assert.ok(ranAfter < 8, `the cap should now block mid-loop, but all ${ranAfter} calls ran`);
  assert.equal(extra, 0, 'a replayed call must not reach the provider');
  assert.equal(ok, true, 'the audit chain failed verify()');
}

// ⚠️ NO `process.exit(0)` HERE. Calling it while the provider SDK's keep-alive socket is still
// closing aborts node on Windows with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` —
// and it does so AFTER the cassette has been written, so a perfectly good recording looks like a
// crash. Measured on the 2026-08-01 live sweep across five providers. Dispatch instead, and let the
// module end normally so node drains its own handles.
if (process.env.RECORD === '1') {
  await recordLive();
} else {
  await offlineDemo();
}
