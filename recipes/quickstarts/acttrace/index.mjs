/**
 * @cendor/acttrace quickstart (JS) — a tamper-evident record of what your agent did.
 *
 * "Prove what the agent saw and decided" is a real ask from compliance, security, and your own
 * future self. acttrace hash-chains every event; verify() re-walks the chain, and a single edited
 * byte breaks it at a known sequence number.
 *
 * Offline: writes/reads a local signed log. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuditLog, verify } from '@cendor/acttrace';

// Demo signing key: env override with a fallback so the recipe is green out of the box.
// In production, load this from your secret manager — never commit a real key.
const SIGNING_KEY = process.env.CENDOR_DEMO_KEY ?? 'demo-signing-key';

const dir = mkdtempSync(join(tmpdir(), 'cendor-recipe-'));
const raw = join(dir, 'audit.jsonl');
const evidence = join(dir, 'evidence.jsonl');

const audit = new AuditLog('support_bot', { riskTier: 'limited', path: raw, signingKey: SIGNING_KEY });

// ⚠️ The one shape that differs from Python. Python opens a decision as a context manager
// (`with audit.decision(input=…) as d1:`); TypeScript has no `with`, so `decision` takes the
// CALLBACK FIRST and its options second — `audit.decision(cb, opts)`. Everything the callback does
// is inside the decision's AsyncLocalStorage scope, so auto-captured calls are tagged with it too.
await audit.decision(
  async (d1) => {
    d1.record({ model: 'gpt-4o', prompt_id: 'summarize@v2' });
    d1.humanOversight('ops@acme', 'approved', 'spot-checked output');
  },
  { input: 'summarize the quarterly refunds report', actor: 'agent' },
);

audit.export(evidence, 'eu_ai_act');
audit.detach(); // flush + close the file before we read/verify it

const [ok, detail] = verify(evidence, { key: SIGNING_KEY });
console.log(`verify: ${ok}  (${detail})`);

// Flip ONE byte inside a hashed payload: 'quarterly' -> 'Quarterly'.
const data = readFileSync(evidence);
const i = data.indexOf(Buffer.from('quarterly'));
assert.notEqual(i, -1, 'the phrase to tamper with is not in the exported evidence');
writeFileSync(evidence, Buffer.concat([data.subarray(0, i), Buffer.from('Q'), data.subarray(i + 1)]));

const [ok2, detail2] = verify(evidence, { key: SIGNING_KEY });
console.log('(1 byte flipped)');
console.log(`verify: ${ok2}  (${detail2})`);

assert.equal(ok, true, 'the clean evidence pack failed verify()');
assert.equal(ok2, false, 'a tampered evidence pack still verified — the chain proves nothing');
