/**
 * acttrace-custom-detector (JS) — teach the redactor about YOUR identifiers.
 *
 * The built-in detectors cover what everyone has: emails, cards, IBANs, API keys. They cannot know
 * that in your system a `PAT-` prefix followed by 24 characters is a partner access token, or that
 * `case/2026/00842` is a case reference that must never reach a log.
 *
 * Two opt-ins close that gap, and both are module-global — you turn them on once at startup:
 *
 *   registerDetector({ category, group, severity, pattern, validator })
 *                                your own pattern, with an optional validator so a format-shaped
 *                                string that fails its checksum is not a false positive
 *   enableLocalePack('uk', 'in') bundled government-ID detectors, off by default because a
 *                                nine-digit-plus-letter pattern would misfire in a locale that does
 *                                not use one
 *
 * Registered detectors are picked up by scan(), redact(), and — via the active policy — by AuditLog's
 * auto-flagging. resetDetectors() puts the registry back to the built-ins.
 *
 * All the identifiers below are synthetic, format-valid examples. Offline, no key.
 * Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';

import {
  Policy,
  enableLocalePack,
  redact,
  registerDetector,
  resetDetectors,
  scan,
} from '@cendor/acttrace';

// A partner access token: shaped like a key, but nothing built in knows the prefix.
const PARTNER_TOKEN = /\bPAT-[A-Za-z0-9]{24}\b/g;

// A case reference with a check digit: the LAST digit is the sum of the others mod 10. Without the
// validator, any five digits would match and every invoice number in the corpus is a finding.
const CASE_REF = /\bcase\/20\d{2}\/\d{5}\b/g;

const caseRefValid = (match: string) => {
  const digits = [...(match.split('/').at(-1) ?? '')].map(Number);
  return digits.slice(0, -1).reduce((a, b) => a + b, 0) % 10 === digits.at(-1);
};

const PAYLOAD = {
  note: 'escalated by dana.smith@contoso.com under case/2026/00842',
  auth: 'PAT-9f2b7c41ea0d5836ab1c4e70',
  nino: 'AB123456C',
  uid: '234567890009',
  invoice: 'case/2026/12345', // right shape, wrong check digit — must NOT be a finding
};

const categories = (obj: unknown) => scan(obj).map((f) => f.category);

resetDetectors();
console.log(`built-ins only    : ${JSON.stringify(categories(PAYLOAD))}`);
console.log('                    (the token, the case ref and both gov IDs are invisible)');

registerDetector({ category: 'partner_token', group: 'secret', severity: 'critical', pattern: PARTNER_TOKEN });
registerDetector({ category: 'case_ref', group: 'pii', severity: 'warning', pattern: CASE_REF, validator: caseRefValid });
const added = enableLocalePack('uk', 'in');

console.log(`locale packs      : enabled ${JSON.stringify(added)}`);
console.log(`after registering : ${JSON.stringify(categories(PAYLOAD))}`);

const findings = Object.fromEntries(scan(PAYLOAD).map((f) => [f.category, f]));
console.log(`validator working : 'case/2026/12345' has the right shape but a bad check digit -> case_ref count is ${findings.case_ref.count}, not 2`);

// Policy resolves per category, falling back to the group. A custom detector in the "secret" group
// inherits whatever the policy says about secrets — no policy edit needed.
const [cleaned, resolved] = redact(PAYLOAD, Policy.strict());
console.log('redact(Policy.strict()):');
for (const f of resolved) {
  console.log(`  ${f.category.padEnd(14)} group=${f.group.padEnd(8)} severity=${f.severity.padEnd(8)} action=${f.action}`);
}
console.log(`  scrubbed payload : ${cleaned.auth} / ${cleaned.nino} / ${cleaned.uid}`);

resetDetectors();
console.log(`resetDetectors()  : back to ${JSON.stringify(categories(PAYLOAD))} - use this between tests`);

if (JSON.stringify(cleaned).includes('PAT-')) throw new Error('the custom secret survived redaction');
assert.equal(findings.case_ref.count, 1, 'the validator did not reject the bad check digit');
if (!findings.uk_nino || !findings.in_aadhaar) throw new Error('the locale packs did not register');
if (categories(PAYLOAD).includes('partner_token')) throw new Error('resetDetectors() left the registry dirty');
