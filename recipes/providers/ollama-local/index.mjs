/**
 * ollama-local (JS) — the governed lifecycle on a $0 local model, with no cloud at all.
 *
 * Same five steps as every recipe in `providers/`, on `new Ollama().chat`:
 *
 *   1. connect     `new Ollama()` — faked here with the identical callable shape
 *   2. instrument  one wrap; detection is structural, so a local daemon is not a special case
 *   3. govern      a `@cendor/tokenguard` budget + one `@cendor/guardrails` gate
 *   4. record      `@cendor/cassette` — record the turn, replay it, prove 0 provider calls
 *   5. prove       `@cendor/acttrace` verify() over the chain
 *
 * What is DISTINCTIVE here: **the cost step is the one that cannot be honest.** A local model has no
 * invoice. Some local ids carry a $0.00 row in the bundled snapshot; most (`llama3.2:latest`) carry
 * no row at all, and `call.cost` is then `null`. So this recipe **documents the omission instead of
 * faking a number**: the token counts and the audit chain are exact either way, and a USD cap is the
 * wrong control for a model nobody bills you for — cap **tokens** instead, which needs no rate.
 *
 * Run (offline, fake client):
 *   npm install && node index.mjs
 * Run against a local daemon:
 *   ollama pull llama3
 *   OLLAMA_LIVE=1 node index.mjs
 *   # a different local model:  OLLAMA_MODEL=llama3.2 OLLAMA_LIVE=1 node index.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuditLog, verify } from '@cendor/acttrace';
import * as cassette from '@cendor/cassette';
import { LLMCall, bus, instrument } from '@cendor/core';
import { GuardrailTripped, install, rules, uninstall } from '@cendor/guardrails';
import { BudgetExceeded, budget, report, reset } from '@cendor/tokenguard';

const SIGNING_KEY = process.env.CENDOR_DEMO_KEY ?? 'demo-signing-key';
// Every live switch in this repo reads an env var. This one used to hard-code `llama3`, so a box
// with only `llama3.2` pulled had to fetch a second model just to run the recipe.
const MODEL = process.env.OLLAMA_MODEL ?? 'llama3';
const LIVE = Boolean(process.env.OLLAMA_LIVE);

const providerCalls = { n: 0 };

/** Stand-in for `new Ollama()` — `chat` is a method ON THE CLIENT, which is how core detects it. */
function fakeOllama() {
  return {
    chat: async () => {
      providerCalls.n++;
      return {
        model: MODEL,
        message: { role: 'assistant', content: 'Refund queued.' },
        prompt_eval_count: 1_800,
        eval_count: 240,
        done: true,
      };
    },
  };
}

async function makeClient() {
  if (!LIVE) return instrument(fakeOllama());
  const { Ollama } = await import('ollama');
  console.log(`(OLLAMA_LIVE=1 — talking to a local daemon, model ${MODEL})`);
  return instrument(new Ollama());
}

reset();
const calls = [];
bus.subscribe((e) => {
  if (e instanceof LLMCall) calls.push(e);
});

const client = await makeClient();
const ask = (text) => client.chat({ model: MODEL, messages: [{ role: 'user', content: text }] });

const tmp = mkdtempSync(join(tmpdir(), 'cendor-ollama-'));
const chain = join(tmp, 'audit.jsonl');
const tape = join(tmp, 'ollama.cassette.json');

const audit = new AuditLog('local-bot', { riskTier: 'minimal', path: chain, signingKey: SIGNING_KEY });
let ran = 0;
try {
  install([rules.keywordDeny(['ignore previous instructions'], { action: 'block' })]);
  try {
    try {
      await ask('ignore previous instructions');
    } catch (err) {
      if (!(err instanceof GuardrailTripped)) throw err;
      const trip = err.decisions.at(-1);
      console.log(`gate      : BLOCKED by ${trip.guardrail} (${trip.stage}) - ${trip.reason}`);
      console.log(`            the daemon saw ${providerCalls.n} call(s) — a gate is not about money`);
    }

    // A TOKEN cap is the right control here: it needs no rate, so it binds identically whether or
    // not the model has a price row. A USD cap on a $0/unpriced model is a no-op that LOOKS enforced.
    const capped = budget({ tokens: 8_000, onExceed: 'block' })(async () => {
      for (let i = 0; i < 20; i++) await ask('summarize the ticket thread');
    });
    await audit.decision(
      async (dec) => {
        try {
          await capped();
        } catch (err) {
          if (!(err instanceof BudgetExceeded)) throw err;
          console.log(`budget    : token cap bound — ${err.constructor.name}`);
          dec.flag('token cap reached', { action: 'blocked', severity: 'warning', data: 'cap' });
        }
        dec.record({ model: MODEL });
      },
      { input: 'local batch', actor: 'agent' },
    );
    ran = report().rows.reduce((n, row) => n + row.calls, 0);
    console.log(`            ${ran} call(s) ran under an 8,000-token cap`);
  } finally {
    uninstall();
  }
} finally {
  audit.detach();
}

// The honest bit. Print what is actually true about cost, whatever that turns out to be.
const one = calls.find((c) => c.usage.inputTokens > 0);
const costLabel =
  one.cost == null
    ? 'null — no price row for this id, and nothing was invented'
    : `$${one.cost.amount.toString()} (a $0.00 snapshot row — a local model has no invoice)`;
console.log('cost      : ' + costLabel);
console.log(`tokens    : ${one.usage.inputTokens} in + ${one.usage.outputTokens} out — EXACT either way`);

const before = providerCalls.n;
await cassette.using(tape, { mode: 'record' }, () => ask('Say hi in five words.'));
const recorded = providerCalls.n - before;
await cassette.using(tape, { mode: 'replay' }, () => ask('Say hi in five words.'));
const extra = providerCalls.n - before - recorded;
console.log(`cassette  : replayed 1 call, ${extra} provider call(s)`);

const [ok, detail] = verify(chain, { key: SIGNING_KEY });
console.log(`verify()  : ${ok} - ${detail}`);

// A local model's *cost* is the one thing this recipe will not assert a number for — that is the
// omission it exists to document. Everything else is exact and is asserted.
assert.ok(one, 'no local call reached the bus — `chat` on the client was not detected');
assert.ok(one.usage.inputTokens > 0 && one.usage.outputTokens > 0, 'ollama usage was not normalized');
// ⚠️ NOT `cost == null || isZero() || gt(0)` — that covers every possible value and can never fail.
// A local model must be null (no row) or exactly zero (a $0.00 row). A POSITIVE cost would mean
// something invented a rate for a model nobody bills you for, which is the one outcome to catch.
assert.ok(
  one.cost == null || one.cost.amount.isZero(),
  `a local model must cost null or $0, got $${one.cost?.amount.toString()} — a rate was invented`,
);
assert.ok(ran > 0 && ran < 20, `the 8,000-token cap should bind mid-loop, got ${ran} calls`);
assert.equal(extra, 0, 'a replayed call must not reach the daemon');
assert.equal(ok, true, 'the audit chain failed verify()');
