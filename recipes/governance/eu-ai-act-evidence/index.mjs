/**
 * eu-ai-act-evidence (JS) — a tamper-evident evidence pack for a high-risk decision.
 *
 * A regulator — or your own compliance team — asks: *what did the agent see, what did it decide,
 * what did it refuse, and can you prove the record was not edited afterward?* A log file answers
 * the first three and cannot answer the fourth.
 *
 * This recipe builds a signed, hash-chained evidence pack containing **both** a decision the model
 * made **and** a decision the policy refused, exports it annotated for a named framework, verifies
 * it through the CLI, then flips one byte and watches it fail.
 *
 * Offline: a fake client, a local signed log. No key, no network.
 * Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuditLog, main as acttraceCli } from '@cendor/acttrace';
import { LLMCall, MISS, addInterceptor, instrument, removeInterceptor } from '@cendor/core';

const SIGNING_KEY = process.env.CENDOR_DEMO_KEY ?? 'demo-signing-key';
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;

/** Your policy exception — throwing it in a guard blocks the call (acttrace records the flag). */
class PolicyViolation extends Error {}

/**
 * A stand-in for `new OpenAI()`. It always approves, deliberately: the evidence pack has to be able
 * to record a decision the model made *and* a decision the policy refused, and only one of those
 * needs a model at all.
 */
function fakeOpenAI() {
  return {
    chat: {
      completions: {
        create: async (_req) => ({
          choices: [{ message: { content: 'Approved: within policy.' } }],
          usage: { prompt_tokens: 60, completion_tokens: 8 },
        }),
      },
    },
  };
}

/**
 * Is the REFUSAL inside the exported pack?
 *
 * This is the check auditors care about and the one most implementations get wrong: a system that
 * logs only what it *did* produces an evidence trail in which a blocked request is
 * indistinguishable from a request nobody ever made. The refusal has to be a first-class record.
 */
function hasRefusal(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .some((line) => {
      const rec = JSON.parse(line);
      return rec.type === 'policy_flag' && rec.payload?.action === 'blocked';
    });
}

const dir = mkdtempSync(join(tmpdir(), 'cendor-euaiact-'));
const raw = join(dir, 'audit.jsonl');
const evidence = join(dir, 'evidence.jsonl');

const audit = new AuditLog('loan_triage', { riskTier: 'high', path: raw, signingKey: SIGNING_KEY });
const client = instrument(fakeOpenAI());
let blocked = false;

// A guard on the `instrument()` seam runs BEFORE the request leaves — so a refusal costs $0 and the
// model provably never saw the SSN. A check inside the handler would be too late twice over: the
// data has already been sent, and the log would say "we sent it, then complained".
const guard = (call) => {
  const messages = call instanceof LLMCall ? call.messages : [];
  const content = messages.map((m) => String(m.content ?? '')).join(' ');
  if (call instanceof LLMCall && SSN.test(content)) {
    audit.flag('SSN in prompt', { action: 'blocked', severity: 'critical', data: 'us_ssn' });
    throw new PolicyViolation('blocked: SSN in prompt');
  }
  return MISS;
};

// `addInterceptor` is process-global, which is why the `finally` below is not optional: leave it
// installed and every later call in the same process is silently gated by this recipe.
addInterceptor(guard);
try {
  await audit.decision(
    async () => {
      try {
        await client.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Applicant SSN 123-45-6789, approve?' }],
        });
      } catch (err) {
        if (!(err instanceof PolicyViolation)) throw err;
        blocked = true; // the model never saw it; the refusal is now in the log
      }
    },
    { input: 'loan application (raw, may contain PII)', actor: 'agent' },
  );

  await audit.decision(
    async (d) => {
      await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Income 90000, score 720. Approve?' }],
      });
      d.record({ model: 'gpt-4o', prompt_id: 'loan_triage@v1' });
      d.humanOversight('risk_officer@bank', 'approved', 'within policy');
    },
    { input: 'loan application (screened)', actor: 'agent' },
  );
} finally {
  removeInterceptor(guard);
}

audit.export(evidence, 'eu_ai_act');
audit.detach();
const refusal = hasRefusal(evidence);

console.log(`SSN-bearing prompt blocked pre-flight : ${blocked} (refusal recorded)`);
console.log(`refusal is inside the evidence pack   : ${refusal}`);
console.log('$ acttrace verify evidence.jsonl --key ***');
const exitOk = acttraceCli(['verify', evidence, '--key', SIGNING_KEY]); // 0 = pass
console.log(`  exit ${exitOk}`);

// The tamper demo. One byte, inside a payload that is hashed into the chain — not a deleted line,
// not a reordered file. A chain that only caught coarse edits would not be worth much.
const data = readFileSync(evidence);
const i = data.indexOf(Buffer.from('approved'));
assert.notEqual(i, -1, 'the phrase to tamper with is not in the exported pack');
writeFileSync(
  evidence,
  Buffer.concat([data.subarray(0, i), Buffer.from('A'), data.subarray(i + 1)]),
);
const exitTampered = acttraceCli(['verify', evidence, '--key', SIGNING_KEY]);
console.log(`$ acttrace verify evidence.jsonl --key ***   (1 byte flipped)`);
console.log(`  exit ${exitTampered}`);

assert.equal(blocked, true, 'the SSN-bearing prompt was NOT blocked pre-flight');
assert.equal(
  refusal,
  true,
  'the refusal is missing from the evidence pack — a blocked request now looks like no request',
);
assert.equal(exitOk, 0, 'the clean evidence pack failed acttrace verify');
assert.notEqual(
  exitTampered,
  0,
  'a tampered evidence pack still verified — the chain proves nothing',
);

console.log(
  '\n⚠️ acttrace produces EVIDENCE TO SUPPORT a compliance case — it is not a compliance ' +
    "guarantee. `framework: 'eu_ai_act'` annotates entries with article references; it certifies " +
    'nothing, and no article is satisfied by a log alone.',
);
