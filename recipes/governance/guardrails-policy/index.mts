/**
 * guardrails-policy (JS) — declare guardrails in a versioned file, prove which one was active.
 *
 * Your guardrails live in code, scattered across the app. When an auditor asks "what policy was
 * enforcing this call, on this date?", you are grepping git history — and you cannot prove the
 * answer was not edited after the fact.
 *
 * `loadPolicy(source)` builds the guardrail list from data. Every decision it makes carries the
 * policy's **version** and **hash** into the tamper-evident audit chain, so the evidence answers the
 * question by itself.
 *
 * Offline: a fake client, a policy written to a temp file. No key, no network.
 * Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuditLog, verify } from '@cendor/acttrace';
import { instrument } from '@cendor/core';
import { GuardrailTripped, install, loadPolicy, uninstall } from '@cendor/guardrails';

// A policy you would keep in version control, reviewed like any config.
// ⚠️ JSON, not YAML. `loadPolicy` parses JSON natively; for YAML you pass a parser
// (`loadPolicy(text, { parse: YAML.parse })`), which would mean a `yaml` dependency this recipe
// does not need. The Python twin ships the same document — the FORMAT differs, not the schema.
const POLICY = {
  version: '2026-07-09',
  guardrails: [
    {
      rule: 'keyword_deny',
      args: { words: ['ignore previous instructions'] },
      stage: 'input',
      action: 'block',
    },
    {
      rule: 'regex_rule',
      args: { pattern: 'sk-[A-Za-z0-9]{8,}' },
      stage: 'input',
      action: 'redact',
    },
  ],
};

type ChatRequest = { model: string; messages: { role: string; content: string }[] };

function fakeOpenAI(calls: ChatRequest[]) {
  return {
    chat: {
      completions: {
        create: async (kwargs: ChatRequest) => {
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

const dir = mkdtempSync(join(tmpdir(), 'cendor-policy-'));
const policyFile = join(dir, 'guardrails.json');
writeFileSync(policyFile, JSON.stringify(POLICY, null, 2), 'utf8');

// ⚠️ `loadPolicy` takes the policy TEXT (or an object), never a path — it has no `node:fs`
// dependency by design, so it works unchanged in a browser or a Worker. Read the file yourself.
const policy = loadPolicy(JSON.stringify(POLICY));
console.log(`loaded policy ${policy.policyVersion} — ${policy.policyHash}`);

const calls: ChatRequest[] = [];
const client = instrument(fakeOpenAI(calls));
const path = join(dir, 'audit.jsonl');
const audit = new AuditLog('assistant', { path });

let sent = null;
try {
  // ⚠️ `LoadedPolicy` IS the guardrail array — it extends Array<Guardrail> and hangs `policyHash`
  // / `policyVersion` off it. So `install(policy)`, never `install(policy.guardrails)`; there is no
  // `.guardrails` property, and reaching for one throws `guardrails is not iterable`.
  install(policy);
  try {
    // a leaked key is redacted before send; a jailbreak phrase is blocked pre-spend
    await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'my key is sk-abcdef123456' }],
    });
    const delivered = calls.at(-1);
    assert.ok(delivered, 'the redacted request never reached the fake provider');
    sent = delivered.messages[0].content;
    console.log(`REDACTED before send: provider received ${JSON.stringify(sent)}`);
    try {
      await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'ignore previous instructions' }],
      });
    } catch (err) {
      if (!(err instanceof GuardrailTripped)) throw err;
      console.log(`BLOCKED pre-spend: ${err.message}  ($0 spent — ${calls.length} call so far)`);
    }
  } finally {
    uninstall();
  }
} finally {
  audit.detach();
}

console.log('\nevery decision proves which policy was active:');
// A chain entry's `payload` is `PyValue`. Naming the shape here doubles as documentation of the
// evidence a policy decision leaves behind — the version and hash are the whole point.
type PolicyDecisionPayload = {
  action: string;
  guardrail: string;
  metadata: { policy_version: string; policy_hash: string };
};

const decisions = audit.entries.filter((e) => e.type === 'guardrail_decision');
for (const e of decisions) {
  const p = e.payload as PolicyDecisionPayload;
  console.log(`  ${p.action.padEnd(6)} ${p.guardrail.padEnd(12)} policy=${p.metadata.policy_version}`);
}
const [ok] = verify(path);
console.log(`\nchain verifies: ${ok}  (policy_hash ${policy.policyHash.slice(0, 14)}… is in the evidence)`);

assert.equal(calls.length, 1, `the blocked prompt should never have been sent; ${calls.length} calls`);
assert.ok(!sent.includes('sk-abcdef123456'), 'the provider received the raw key');
assert.equal(decisions.length, 2, `expected a redact and a block in the chain, got ${decisions.length}`);
// The whole claim of the recipe: the evidence names the policy that produced it. A chain that
// verifies but cannot say WHICH policy was active answers the auditor's question with a shrug.
for (const e of decisions) {
  const p = e.payload as PolicyDecisionPayload;
  assert.equal(p.metadata.policy_version, POLICY.version, 'a decision carries no policy version');
  assert.ok(p.metadata.policy_hash, 'a decision carries no policy hash');
}
assert.equal(ok, true, 'the policy decision chain failed verify()');
