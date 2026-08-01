# acttrace-custom-detector (JS) — teach the redactor about *your* identifiers

**The pain.** The built-in detectors cover what everyone has: emails, cards, IBANs, API keys. They
cannot know that in your system a `PAT-` prefix followed by 24 characters is a partner access token,
or that `case/2026/00842` is a case reference that must never reach a log. So the one identifier that
is actually specific to you is the one that leaks.

**What this shows.** Two opt-ins, both module-global (you turn them on once at startup):

- `registerDetector({ category, group, severity, pattern, validator })` — your own pattern, with an
  optional **validator** so a format-shaped string that fails its checksum is not a false positive.
- `enableLocalePack('uk', 'in')` — bundled government-ID detectors, off by default because a
  nine-digit-plus-letter pattern would misfire badly in a locale that does not use one.

Registered detectors are picked up by `scan()`, `redact()`, and — via the active policy — by
`AuditLog`'s auto-flagging. `resetDetectors()` restores the built-ins.

## Run it

```bash
cd recipes/libs/acttrace-custom-detector
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
built-ins only    : ["email"]
                    (the token, the case ref and both gov IDs are invisible)
locale packs      : enabled ["uk_nino","in_aadhaar"]
after registering : ["case_ref","email","in_aadhaar","partner_token","uk_nino"]
validator working : 'case/2026/12345' has the right shape but a bad check digit -> case_ref count is 1, not 2
redact(Policy.strict()):
  case_ref       group=pii      severity=warning  action=redact
  email          group=pii      severity=warning  action=redact
  in_aadhaar     group=gov_id   severity=critical action=block
  partner_token  group=secret   severity=critical action=block
  uk_nino        group=gov_id   severity=critical action=block
  scrubbed payload : <redacted> / <redacted> / <redacted>
resetDetectors()  : back to ["email"] - use this between tests
```

The first line is the honest baseline: out of five sensitive values in the payload, the built-ins found
**one**. Four registrations later, all five are found.

**The `validator` is the part people skip.** The payload contains two strings matching
`case/20\d{2}/\d{5}`; only one has a valid check digit, and only one becomes a finding. Without the
validator, every invoice number in your corpus is a false positive — and a detector that cries wolf
gets switched off, which is worse than not having it.

**You do not edit the policy.** A custom detector declares a `group`, and the policy resolves on
category-then-group, so `partner_token` inherits whatever `Policy.strict()` says about secrets.

Byte-identical output to the Python twin — including the locale packs, which are fully ported
(same NINO and Verhoeff validators). Note the shape difference: a TS `Detector` is a plain object with
a `RegExp` `pattern`, where Python uses a dataclass with a compiled pattern.

Every identifier here is synthetic and format-valid — nothing real is committed.

Python twin: [`libs/acttrace-custom-detector`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/libs/acttrace-custom-detector) ·
Packages: `@cendor/acttrace` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/acttrace  ^3.1.0
```

⚠️ **A caret is not a floor you can forget.** At `3.x` a caret spans the whole major, so a newer
patch or minor than the numbers above is expected, not drift — but the reverse also holds:
`npm install` over an existing `node_modules` is **lock-obedient, not a refresh**, and will happily
leave you on an older 3.x while everything still passes. To move onto what is actually published:

```bash
rm -rf node_modules package-lock.json && npm install
node ../../../scripts/check-one-core.mjs .
```

That second line is the one that matters after any `@cendor/core` minor: **the whole `@cendor/*` set
moves together**, and a sibling left behind resolves a *second* copy of `@cendor/core` — two event
buses, so a guardrail decision never reaches the budget, and nothing fails to say so.
