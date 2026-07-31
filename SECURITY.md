# Security Policy

We take the security of the Cendor projects seriously. Thank you for helping keep them and their
users safe.

This file is repo-local on purpose: the `cendorhq/.github` organisation repository is private, so
GitHub serves no org-wide default here.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report vulnerabilities privately through **GitHub Private Vulnerability Reporting**: open the
[**Security** tab of this repository](https://github.com/cendorhq/cendor-cookbook-js/security/advisories/new)
and choose **Report a vulnerability**. This creates a private advisory only the maintainers can see,
and lets us collaborate on a fix and coordinate disclosure with you.

If Private Vulnerability Reporting is not enabled here, open a **draft security advisory** on
[`cendorhq/cendor-libs-js`](https://github.com/cendorhq/cendor-libs-js/security/advisories/new) and
we will route it.

Please include, where you can:

- the affected recipe(s), or the affected package(s) and version(s),
- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- any known mitigations.

## Scope

**This repository ships no package.** It is a set of copy-paste recipes — each a folder with its own
`package.json` pinning the *released* `@cendor/*` packages — that run offline against fake
provider-shaped clients. So the two halves of the threat model are:

**In scope here** — anything wrong with the recipes themselves, because people copy them:

- a recipe that teaches an **unsafe pattern** (a guardrail wired so it cannot bind, an audit chain
  never verified, a budget that silently fails open),
- a recipe or fixture that **leaks a credential** — a real key in a committed cassette, a secret that
  survived redaction on record, a `.env` that escaped `.gitignore`,
- unsafe deserialization of a cassette or policy file as a recipe uses it.

**Report against [`cendorhq/cendor-libs-js`](https://github.com/cendorhq/cendor-libs-js) instead** if
the flaw is in a library rather than in how a recipe drives it — redaction bypasses in
`@cendor/acttrace`, incorrect budget enforcement in `@cendor/tokenguard`, audit-chain verification
flaws, and so on. Those are **local-first libraries**: they run in your process, with no
Cendor-operated servers or network services, so there is no hosted endpoint to attack. A flaw in the
agent SDK belongs to [`cendorhq/cendor-sdk-js`](https://github.com/cendorhq/cendor-sdk-js).

`acttrace` produces **evidence to support** a compliance case — it is not a compliance guarantee, and
nothing here is legal advice.

## Out of scope

- **CI has no secrets, by design.** Every job runs the recipes offline with no API key and no
  provider network call. "A recipe would leak a key if you gave CI one" is a report we welcome; "CI
  has no key" is not a finding.
- Vulnerabilities in a third-party framework a recipe *bridges to* (the Microsoft 365 Agents SDK,
  Express, zod) belong to that project. Tell us anyway if our bridge makes the impact worse than it
  would otherwise be.

## What to expect

- We aim to acknowledge a report within a few business days.
- We'll work with you on a fix and a coordinated disclosure timeline, and credit you in the advisory
  unless you prefer to remain anonymous.

## Supported versions

**The cookbook itself is not versioned for consumers** — there are no releases to back-port to. Fixes
land on `main`, and every recipe pins a *caret range* that re-resolves on each CI run, so a security
fix in a library reaches the recipes as soon as it is published.

Library fixes land on the latest released minor of each affected package. Because versions are
independent across languages, a fix may ship on different version numbers in Python and TypeScript.
