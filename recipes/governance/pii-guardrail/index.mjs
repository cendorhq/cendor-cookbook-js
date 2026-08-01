/**
 * pii-guardrail (JS) — PII/secrets as a guardrail, with the audit trail to prove it.
 *
 * You want PII and secrets scrubbed *before* a payload reaches the model — and you want ONE
 * detection engine, not a second half-baked regex list bolted onto your guardrails.
 *
 * `@cendor/acttrace` already ships the detector catalogue (with real validators: Luhn, IBAN mod-97,
 * Verhoeff, ABA, SSN, BIC). This recipe wraps it as a `rules.custom` guardrail in three lines of
 * real logic — scan, decide, redact — so the same engine that writes your audit trail also gates
 * the wire. The reason names the CATEGORIES found, never the raw value.
 *
 * Offline: a fake client, local regex + validators. No key, no network, no model.
 * Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuditLog, Policy, redact, scan, verify } from '@cendor/acttrace';
import { instrument } from '@cendor/core';
import { Verdict, install, rules, uninstall } from '@cendor/guardrails';

/**
 * A guardrail that scans a payload with acttrace's catalogue and redacts/blocks/flags PII.
 * Three lines of real logic wrapped as a deterministic guardrail.
 */
function piiGuardrail({ policy = null, stage = 'input', action = 'redact' } = {}) {
  const active = policy ?? Policy.default(); // redacts secrets + emails, flags the rest
  const check = (payload) => {
    const findings = scan(payload, active).filter((f) => f.action !== 'allow');
    if (findings.length === 0) return null;
    const cats = [...new Set(findings.map((f) => f.category))].sort().join(', ');
    if (action === 'redact') {
      const [cleaned] = redact(payload, active);
      return new Verdict('redact', `pii: ${cats}`, cleaned);
    }
    return new Verdict(action, `pii: ${cats}`);
  };
  return rules.custom(check, { stage, name: 'pii' });
}

function fakeOpenAI(calls) {
  return {
    chat: {
      completions: {
        create: async (kwargs) => {
          calls.push(kwargs);
          return {
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 10, completion_tokens: 2 },
          };
        },
      },
    },
  };
}

const calls = [];
const client = instrument(fakeOpenAI(calls));
const path = join(mkdtempSync(join(tmpdir(), 'cendor-pii-')), 'audit.jsonl');
const audit = new AuditLog('assistant', { path });

let sent = null;
try {
  install([piiGuardrail({ action: 'redact', stage: 'input' })]);
  try {
    await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'email alice@example.com the invoice' }],
    });
    sent = calls.at(-1).messages[0].content;
    console.log(`REDACTED before send: provider received ${JSON.stringify(sent)}`);
  } finally {
    uninstall();
  }
} finally {
  audit.detach();
}

console.log('\nguardrail_decision entries in the audit chain:');
const decisions = audit.entries.filter((e) => e.type === 'guardrail_decision');
for (const e of decisions) {
  console.log(`  ${String(e.payload.action).padEnd(6)} ${String(e.payload.stage).padEnd(6)} ${e.payload.guardrail}  ${e.payload.reason}`);
}
const [ok] = verify(path);
console.log(`\nchain verifies: ${ok}  (the email never left the process in the clear)`);

// `sent` is what the PROVIDER was handed — read out of the fake's own record, UNDER the interceptor
// chain. A probe that reads the caller's arguments sits above it, sees the raw address, and reports
// a working redaction as a leak.
assert.equal(calls.length, 1, 'the call did not reach the provider at all');
assert.ok(!sent.includes('alice@example.com'), 'the provider received the raw email address');
assert.ok(sent.includes('<redacted>'), `nothing was redacted in ${JSON.stringify(sent)}`);
assert.equal(decisions.length, 1, 'the redaction was not recorded in the audit chain');
// The reason must name the CATEGORY and never the value — that is the difference between an audit
// trail and a second copy of the leak.
assert.ok(decisions[0].payload.reason.startsWith('pii: '), 'the decision did not name the category');
assert.equal(ok, true, 'the audit chain failed verify()');

// ── Defence in depth, DEMONSTRATED rather than asserted ──────────────────────────────────────────
// The obvious next assertion is `!JSON.stringify(payload).includes('alice@example.com')`. Measured
// 2026-08-01: **that assertion can never fail**, because `AuditLog` runs its own redactor on the way
// in — so even a badly-written guardrail that pastes a raw address into its `reason` cannot turn the
// audit trail into a second copy of the leak. A check that cannot fail is not a check, so instead of
// asserting it, the recipe SHOWS it: a deliberately-leaky verdict, and what actually lands on disk.
const leaky = new Verdict('redact', 'pii: email alice@example.com', 'clean');
const leakPath = join(mkdtempSync(join(tmpdir(), 'cendor-pii-leak-')), 'audit.jsonl');
const leakAudit = new AuditLog('assistant', { path: leakPath });
install([rules.custom(() => leaky, { stage: 'input', name: 'leaky' })]);
try {
  await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'ping' }],
  });
} finally {
  uninstall();
  leakAudit.detach();
}
const onDisk = readFileSync(leakPath, 'utf8');
console.log('\nA guardrail that pastes the raw address into its own reason:');
console.log(`  reason as written : ${JSON.stringify(leaky.reason)}`);
// The LAST entry is the llm_call, not the decision — pick the decision explicitly.
const leakDecision = leakAudit.entries.filter((e) => e.type === 'guardrail_decision').at(-1);
console.log(`  reason on disk    : ${JSON.stringify(leakDecision.payload.reason)}`);
console.log(`  address on disk   : ${onDisk.includes('alice@example.com')}  <- AuditLog redacts on write`);
assert.ok(onDisk.includes('<redacted>'), "acttrace's own redactor did not scrub the chain");
assert.equal(
  onDisk.includes('alice@example.com'),
  false,
  'the raw PII value reached the chain — the AuditLog redactor is no longer defending you',
);

console.log(
  '\n⚠️ Parity note: the regex + validator catalogue above is IDENTICAL to Python. What differs is ' +
    'the optional NER layer — Python uses Presidio (spaCy transformers), TypeScript uses the ' +
    'optional `compromise` peer, which is English-only with LOWER recall. It is a useful extra ' +
    'layer, NOT a sufficient sole PII control in either language. See the parity matrix.',
);
