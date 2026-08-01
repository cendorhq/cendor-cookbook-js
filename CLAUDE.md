# CLAUDE.md — cendor-cookbook-js

The org constitution is the workspace-root `cendorhq/CLAUDE.md` — a maintainer's local multi-repo
checkout, **not published anywhere**, so don't go looking for it. This file exists so the rules below
travel WITH the repo: a session checked out here alone must still see them. Nothing here binds a
contributor — [`CONTRIBUTING.md`](CONTRIBUTING.md) is the contract for that.

- **No `Co-Authored-By` trailer** on commits (org-wide rule).

## What this repo is, and why it is separate

The **TypeScript half** of the Cendor Cookbook. Its Python half is
[`cendorhq/cendor-cookbook`](https://github.com/cendorhq/cendor-cookbook); the two are twins, not
forks — a recipe folder name means the same thing in both trees.

The split is deliberate. A single repo carrying a root `pyproject.toml` *and* scattered
`package.json` files gives a devcontainer no unambiguous toolchain to provision (GitHub Codespaces
picks one and the other language degrades), and it couples two dependency graphs that have no
business constraining each other. One repo per toolchain keeps both simple.

**Recipe folder names are an API.** cendor.ai `/cookbook` deep-links to them and the MCP docs server
indexes them. Never rename one — not even when moving a recipe between the two cookbooks.

### The four folder names that differ from their Python twin

A new recipe uses the **bare Python folder name**. These four are the complete list of exceptions;
do not add a fifth without a reason as specific as these, and do not "fix" any of them:

| here | Python twin | why |
|---|---|---|
| `quickstarts/core-js` | `quickstarts/core` | historical, from before the cookbooks were split |
| `sdk/governed-agent-js` | `sdk/governed-agent` | historical |
| `agents/m365-custom-engine-js` | `agents/m365-custom-engine-py` | historical |
| `testing/vitest-cassette` | `testing/pytest-cassette` | **deliberate** (2026-08-01). `pytest` is a Python toolchain name baked into a folder name; a TS folder called `pytest-cassette` is wrong on its face, and the twin genuinely *is* a different test runner |

The first three are frozen because renaming them would break a cendor.ai deep link and the MCP index
— not because they are good names. Every recipe added since uses the bare name.

**One Python recipe has no twin here, on purpose:** `apps/chat-playground` is a Gradio app, and
Gradio is Python-only. A TypeScript port would be a different application wearing a twin's folder
name. It is documented in [`README.md`](README.md); do not "close the gap".

## Cardinal rules

1. **Every recipe runs offline, with no API key.** CI has no secrets and never will. A recipe that
   needs a key to go green is a bug in the recipe. Offline is achieved with a fake provider-shaped
   client (`instrument()` identifies a client by its *shape*) or a committed cassette fixture.
2. **Node 20 and 22 are in the CI matrix, always.** A recipe green only on the newest Node proves
   nothing about the LTS — `AsyncLocalStorage` in particular behaves differently on legacy-ALS Node
   (20/22) than on 24, and `@cendor/core` shipped a real bug that was invisible on 24.
3. **Per-recipe `npm install`.** Each recipe carries its own `package.json` with its own pins,
   because that is what proves a copy-pasteable `package.json` actually resolves. No workspace, no
   hoisting, no shared lockfile.
4. **Exactly one `@cendor/core` per recipe** — `node scripts/check-one-core.mjs <dir>…`, run per
   recipe in CI. Two cores are two event buses, so a guardrail decision never reaches the SDK and
   *nothing fails to say so*. This is why the whole `@cendor/*` set is bumped together, never core
   alone.
5. **Money is `decimal.js`, never a float.** `call.cost.amount.toString()`, not `Number(...)`.
6. **No tool→tool imports.** Recipes compose the libraries only through the documented seams —
   `instrument()`, the `@cendor/core` bus, the protocols. Never reach into one package from another.
7. **Honest claims.** Any cost printed comes from `prices.estimate(...)` on stated token counts. A
   framework *works alongside* Cendor; it is never an "official integration". `acttrace` produces
   **evidence to support** a compliance case, not a guarantee.
8. **A Python-only capability gets a documented omission, never a fake TypeScript sample.** The
   parity matrix (`cendor-libs-js/docs/parity.md`) is the contract. See the parity notes in
   [`README.md`](README.md).

## Versioning — the org standard (see the workspace `CLAUDE.md`)

1. **A MAJOR bump needs Raghav's explicit approval. Never autonomous.** Propose it, say what breaks,
   wait. **Minor and patch need no approval** — ship them.
   ⚠️ **Unenforced here — the rule is on you.** This repo publishes nothing, so its own version is
   inert. What a major bump means *here* is the **`@cendor/*` ranges the recipes pin**. Crossing one
   of those to a new major is the decision that needs approval.
2. **All libraries in one language share ONE major** — `@cendor/*` move together. Minors and patches
   stay independent per package.
3. **Majors are NOT coupled across languages.** The parity matrix is the contract, not matching
   numbers.
4. **Use minors.** A new capability is a **minor**; a fix is a **patch**.

## The pin ritual

After any `@cendor/core` **minor**, bump the **whole `@cendor/*` set** in every recipe that pins one
— not just core. A sibling left on the previous core minor resolves a *second* copy of
`@cendor/core`. A caret pin resolves only within its major, so a stale pin rots **silently green**:
the recipe still runs, it just runs on an old shelf and stops teaching what is published.

The workspace gate `scripts/check-versions.mjs` asserts every recipe's pins against
`cendor-site/src/data/versions.json`, and dependabot raises a weekly PR per recipe directory.
`scripts/check-one-core.mjs` here is a **vendored byte-identical copy** of the canonical workspace
script — the same gate asserts it has not drifted. Fix the canonical, then re-copy.
