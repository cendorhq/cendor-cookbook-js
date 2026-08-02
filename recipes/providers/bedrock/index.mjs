/**
 * bedrock (JS) — the governed lifecycle where every id is unpriced and the usage keys are camelCase.
 *
 * Same five steps as every recipe in `providers/`, on **aws-sdk-v3 Converse**:
 *
 *   1. connect     a `BedrockRuntimeClient`-shaped client — faked transport, REAL `ConverseCommand`
 *   2. instrument  one wrap. The CLIENT is identified by `config.serviceId === 'Bedrock Runtime'`
 *                  and the COMMAND per call, so `send(new ConverseCommand(…))` is captured directly.
 *   3. govern      a `@cendor/tokenguard` budget (token **and** USD) + one `@cendor/guardrails` gate
 *   4. record      `@cendor/cassette` replay — 0 provider calls, $0
 *   5. prove       `@cendor/acttrace` verify() + a cost that came from `prices`
 *
 * ⚠️ **This is `send(new ConverseCommand(…))`, not a `converse()` shim.** Since `@cendor/core` 3.3.0
 * core detects an aws-sdk-v3 Bedrock Runtime client and captures the Converse family per command.
 * Before that, libs-only TypeScript Bedrock got **zero** capture — no budget, no guard, no audit —
 * which cendor-testsuits recorded every run as the most surprising gap in the JS port. Stop writing
 * the synthetic `converse()` wrapper; it is no longer needed. (`InvokeModelCommand` is deliberately
 * NOT captured: its bodies are opaque per-model JSON, and a confidently wrong token count is worse
 * than an honest gap. Any other AWS command through the same `send` passes through untouched.)
 *
 * What is DISTINCTIVE here: **an unpriced model id, and camelCase usage.** Converse reports
 * `usage: { inputTokens, outputTokens }` — camelCase, where an OpenAI reader looks for
 * `usage.prompt_tokens` — and most Bedrock **model ids** are marketplace ids
 * (`eu.amazon.nova-2-lite-v1:0`) with no row in the price table. The recipe shows the two caps that
 * still work on an unpriced model:
 *
 *   * a **token** budget binds with no rate at all — it counts tokens, not dollars;
 *   * a **USD** budget binds after one `prices.registerModelPrice(...)` line, yours to supply.
 *
 * ⚠️ Not every Bedrock id is unpriced. The lookup strips the region prefix, the vendor prefix and
 * `-v1:0`, so a **current** Bedrock Claude id prices itself with no registration
 * (`eu.anthropic.claude-sonnet-4-6-v1:0`), while Nova / Llama / Mistral and **retired** Claude ids
 * do not. The same cap in the same code binds on one model and is a silent no-op on the next —
 * which is why step 5 asserts the price exists rather than trusting it.
 *
 * Offline: a faked transport under the real command classes. No credentials, no network.
 * Run:  npm install && node index.mjs
 *
 * Record a real cassette (maintainer, needs AWS credentials):
 *   RECORD=1 AWS_REGION=eu-west-1 BEDROCK_MODEL_ID=eu.amazon.nova-2-lite-v1:0 node index.mjs
 *   # IAM key pair:    AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
 *   # Bedrock API key: AWS_BEARER_TOKEN_BEDROCK — bearer auth, and it must be the ONLY credential
 *   #   set. Parked in the IAM variables instead it fails `UnrecognizedClientException`, which reads
 *   #   like a dead credential and is neither.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { AuditLog, verify } from '@cendor/acttrace';
import * as cassette from '@cendor/cassette';
import { LLMCall, bus, instrument, prices } from '@cendor/core';
import { GuardrailTripped, install, rules, uninstall } from '@cendor/guardrails';
import { BudgetExceeded, budget, report, reset } from '@cendor/tokenguard';

const SIGNING_KEY = process.env.CENDOR_DEMO_KEY ?? 'demo-signing-key';
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'eu.amazon.nova-2-lite-v1:0';
/** A CURRENT Bedrock Claude id. Unlike MODEL_ID it prices with no registration at all, because the
 *  lookup strips the region prefix, the vendor prefix and `-v1:0` down to a base the table knows. */
const PRICED_ID = 'eu.anthropic.claude-sonnet-4-6-v1:0';
/** `refresh({ source: 'aws' })` is per region, like Amazon's own price files. */
const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
const IN_TOKENS = 4_000;
const OUT_TOKENS = 700;

const providerCalls = { n: 0 };

/**
 * A `BedrockRuntimeClient`-shaped stand-in. `config.serviceId` is the primary detection signal —
 * measured on @aws-sdk/client-bedrock-runtime to be a plain, synchronously-readable string, unlike
 * most of that config. The commands sent through it are the REAL `ConverseCommand` class; only the
 * transport is faked, so the call shape below is exactly the one you would write in production.
 */
function fakeBedrockClient() {
  return {
    config: { serviceId: 'Bedrock Runtime' },
    send: async (_command) => {
      providerCalls.n++;
      return {
        output: { message: { role: 'assistant', content: [{ text: 'Refund queued.' }] } },
        stopReason: 'end_turn',
        usage: {
          inputTokens: IN_TOKENS,
          outputTokens: OUT_TOKENS,
          totalTokens: IN_TOKENS + OUT_TOKENS,
        },
        $metadata: { httpStatusCode: 200 },
      };
    },
  };
}
/**
 * Handed the offline fake AND — under RECORD=1 — a real `BedrockRuntimeClient`, whose `send` is
 * generic over every Bedrock command. This helper needs only 'something with a send', so that is
 * what it asks for.
 */

const converse = (client, text) =>
  client.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      messages: [{ role: 'user', content: [{ text }] }],
    }),
  );

async function recordLive() {
  const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
  const client = instrument(new BedrockRuntimeClient({ region: process.env.AWS_REGION }));
  const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bedrock.json');
  await cassette.use(fixture, { mode: 'record' })(async () => {
    await converse(client, 'Say hi in five words.');
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

  const client = instrument(fakeBedrockClient());

  const tmp = mkdtempSync(join(tmpdir(), 'cendor-bedrock-'));
  const chain = join(tmp, 'audit.jsonl');
  const tape = join(tmp, 'bedrock.cassette.json');

  const audit = new AuditLog('bedrock-bot', {
    riskTier: 'limited',
    path: chain,
    signingKey: SIGNING_KEY,
  });

  // ---- the honest first look: is this id priced at all? -------------------------------------------
  let pricedBefore = true;
  try {
    prices.estimate(MODEL_ID, 1000, { outputTokens: 100 });
  } catch {
    pricedBefore = false;
  }
  console.log(`price     : ${MODEL_ID}`);
  console.log(`            in the table before registering? ${pricedBefore}`);

  try {
    install([rules.keywordDeny(['ignore previous instructions'], { action: 'block' })]);
    try {
      try {
        await converse(client, 'ignore previous instructions');
      } catch (err) {
        if (!(err instanceof GuardrailTripped)) throw err;
        const trip = err.decisions.at(-1);
        assert.ok(trip, 'GuardrailTripped carried no decisions');
        console.log(`gate      : BLOCKED by ${trip.guardrail} (${trip.stage}) - ${trip.reason}`);
        console.log(`            provider saw ${providerCalls.n} call(s) => $0 spent on it`);
      }

      // (3a) A TOKEN cap needs no rate — it binds on an unpriced model exactly as it does on a
      // priced one. This is the control to reach for when you do not hold the rate card.
      const tokenCapped = budget({ tokens: 20_000, onExceed: 'block' })(async () => {
        for (let i = 0; i < 50; i++) await converse(client, 'summarize the ticket');
      });
      await audit.decision(
        async (dec) => {
          try {
            await tokenCapped();
          } catch (err) {
            if (!(err instanceof BudgetExceeded)) throw err;
            console.log(
              `budget    : token cap bound with NO price at all — ${err.constructor.name}`,
            );
            dec.flag('token cap reached', { action: 'blocked', severity: 'warning', data: 'cap' });
          }
          dec.record({ model: MODEL_ID });
        },
        { input: 'bedrock batch', actor: 'agent' },
      );
      const tokenRun = report().rows.reduce((n, row) => n + row.calls, 0);
      console.log(`            ${tokenRun} call(s) ran under a 20,000-token cap`);
    } finally {
      uninstall();
    }
  } finally {
    audit.detach();
  }

  // (3b) A USD cap needs a rate. One line supplies it — you hold the number, not us.
  prices.registerModelPrice(MODEL_ID, { input: 0.06, output: 0.24 }); // USD per 1M tokens
  const after = prices.estimate(MODEL_ID, IN_TOKENS, { outputTokens: OUT_TOKENS });
  console.log(
    `            registerModelPrice() -> the SAME call now costs $${after.amount.toString()}`,
  );

  reset();
  const usdCapped = budget({ usd: 0.001, onExceed: 'block' })(async () => {
    for (let i = 0; i < 50; i++) await converse(client, 'summarize the ticket');
  });
  try {
    await usdCapped();
  } catch (err) {
    if (!(err instanceof BudgetExceeded)) throw err;
    console.log(`            and a USD cap now binds too — ${err.constructor.name}`);
  }
  const usdRun = report().rows.reduce((n, row) => n + row.calls, 0);

  // (3c) SHOW where each rate came from. `prices.explain(id)` is the difference between "the cost
  // is 0.0001428" and "the cost is 0.0001428 because I typed that rate in". Two different answers
  // on the same table, which is the whole Bedrock pricing story.
  const mine = prices.explain(MODEL_ID);
  const theirs = prices.explain(PRICED_ID);
  console.log(`explain   : ${mine.summary()}`);
  console.log(
    `            how=${JSON.stringify(mine.how)} registered=${mine.registered}  <- YOUR line, not a table`,
  );
  console.log(`explain   : ${theirs.summary()}`);
  console.log(
    `            how=${JSON.stringify(theirs.how)} registered=${theirs.registered}  <- normalized, no code`,
  );

  // (3d) You may not have to type Amazon's rate card in at all. `refresh({ source: 'aws' })` reads
  // **Amazon's own** Bedrock price files: a static, public JSON document that needs NO AWS
  // credentials — you are pricing a model, not calling one. Keyless, so this is a LIVE=1 section
  // rather than a RECORD=1 one: nothing to record, no key to leak.
  //
  // ⚠️ TWO THINGS THAT LOOK LIKE FAILURES AND ARE NOT, both printed below:
  //  (a) refresh({ source }) REPLACES the table; it does not merge into it. A first-party catalog
  //      is authoritative AND narrow, so a model the bundled snapshot priced can come back
  //      UNPRICED. That is the trade, stated: a bare refresh() (the cendor-prices feed) is the one
  //      that reconciles first-party catalogs with the aggregators, and it is the default for
  //      exactly this reason.
  //  (b) MODEL_ID stays registered. A registration outranks every table forever — the precedence
  //      contract working, not the fetch failing.
  if (process.env.LIVE === '1') {
    const beforeRows = prices.models().length;
    const was = prices.explain(PRICED_ID).how;
    const fetched = await prices.refresh(undefined, { source: 'aws', region: AWS_REGION });
    console.log(
      `aws       : refresh({ source: 'aws', region: '${AWS_REGION}' }) -> ${fetched}, ${beforeRows} rows -> ${prices.models().length}, as of ${prices.snapshotDate()}   (no AWS credentials)`,
    );
    console.log(`            confirms : ${prices.explain('us.amazon.nova-lite-v1:0').summary()}`);
    console.log('                       == the input: 0.06 / output: 0.24 per 1M typed in above');
    console.log(
      `            REPLACED : ${PRICED_ID} was ${JSON.stringify(was)}, is now ${JSON.stringify(prices.explain(PRICED_ID).how)}`,
    );
    console.log(
      '                       a first-party catalog is authoritative AND narrow; the bare',
    );
    console.log('                       refresh() feed is the one that reconciles them');
    console.log(
      `            yours    : ${MODEL_ID} still registered=${prices.explain(MODEL_ID).registered}`,
    );
  } else {
    console.log(
      "aws       : set LIVE=1 to price Bedrock ids from Amazon's own public price files (keyless): prices.refresh(undefined, { source: 'aws', region })",
    );
  }

  // (4) record
  const before = providerCalls.n;
  await cassette.using(tape, { mode: 'record' }, () => converse(client, 'Say hi in five words.'));
  const recorded = providerCalls.n - before;
  await cassette.using(tape, { mode: 'replay' }, () => converse(client, 'Say hi in five words.'));
  const extra = providerCalls.n - before - recorded;
  console.log(`cassette  : replayed 1 call, ${extra} provider call(s), $0`);

  const [ok, detail] = verify(chain, { key: SIGNING_KEY });
  console.log(`verify()  : ${ok} - ${detail}`);

  // (5) prove. The camelCase usage was normalized, the unpriced id really was unpriced, and both caps
  // bound. Asserting `pricedBefore === false` is the point of the whole recipe: if a future snapshot
  // starts carrying this id, this line fails and the prose above stops being true — which is exactly
  // when someone should be told.
  // `usage` is nullable on LLMCall, so the predicate has to say so — and `find` returns
  // `T | undefined`, which the assert turns into a named failure instead of a TypeError.
  const one = calls.find((c) => (c.usage?.inputTokens ?? 0) > 0);
  assert.ok(one?.usage, 'no call on the bus carried normalized usage');
  assert.ok(one, 'no Bedrock call reached the bus — send(new ConverseCommand(…)) was not captured');
  assert.equal(
    one.usage.inputTokens,
    IN_TOKENS,
    'camelCase `usage.inputTokens` was not normalized',
  );
  assert.equal(
    one.usage.outputTokens,
    OUT_TOKENS,
    'camelCase `usage.outputTokens` was not normalized',
  );
  assert.equal(
    pricedBefore,
    false,
    `${MODEL_ID} is now in the price table — this recipe's premise changed`,
  );
  assert.ok(after.amount.gt(0), 'registerModelPrice() did not make the model priceable');
  assert.ok(usdRun > 0 && usdRun < 50, `the USD cap should bind mid-loop, got ${usdRun} calls`);
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
