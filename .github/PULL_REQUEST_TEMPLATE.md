<!-- Thanks for the PR. The full recipe standard is in CONTRIBUTING.md. -->

## What & why

<!-- Which recipe, and what pain does it prove away? Link the related issue. Explain the *why* — that
     is the part a reviewer cannot reconstruct from the diff. -->

Recipe(s): <!-- e.g. recipes/libs/tokenguard-durable-spend -->

## The one hard gate: it runs green offline

CI has **no secrets, ever**. A recipe must produce its money shot with no API key in the environment
and no network call to a model provider.

```bash
# From inside the recipe directory — a per-recipe install is what proves a copy-pasteable
# package.json actually resolves. There is no workspace here.
(cd recipes/<category>/<name> && npm install && node index.mjs)

# G1 — exactly one @cendor/core
node scripts/check-one-core.mjs recipes/<category>/<name>

# Every recipe is reachable from a CI shard
node scripts/check-recipe-coverage.mjs
```

- [ ] The recipe printed its money shot **with no key set** and no provider network call
- [ ] It runs on **Node 20 and 22** — not just my local Node. A recipe green only on the newest Node
      proves nothing about the LTS (`AsyncLocalStorage` behaves differently on legacy-ALS Node, and
      `@cendor/core` shipped a real bug that was invisible on 24)
- [ ] `node scripts/check-one-core.mjs …` passes — two `@cendor/core` copies are two event buses, so
      a guardrail decision never reaches the SDK and *nothing fails to say so*
- [ ] `node scripts/check-recipe-coverage.mjs` passes
- [ ] Gates were run **bare**, and I read the exit code — never pipe a gate into `tail`/`grep` and
      chain off `&&` (a pipeline's exit code is the last command's)

## Checklist

- [ ] `README.md` follows the house shape: the **pain** (2–3 lines) → **what it shows** → the **run
      command** → an **expected-output** snippet containing the money shot
- [ ] The README's expected-output snippet matches what the recipe actually prints, character for
      character
- [ ] `index.mjs` is roughly 80 lines or fewer and is copy-paste runnable from the recipe directory
- [ ] `package.json` carries the recipe's **own** pins (`"type": "module"`, `"private": true`), with
      caret ranges on every `@cendor/*` it imports
- [ ] `.github/dependabot.yml` has an `npm` entry for the recipe directory — nothing globs
      directories in dependabot, so a new recipe's pins are otherwise unwatched
- [ ] I did **not** rename an existing recipe folder — those names are an API the cendor.ai
      `/cookbook` page deep-links to and the MCP docs server indexes
- [ ] I did not bump any `@cendor/*` range across a **major** — that is a maintainer decision

## Honest claims

- [ ] No invented metrics. Every cost printed traces to `prices.estimate(...)` on stated token counts,
      and money is `decimal.js` (`cost.amount.toString()`), never a float
- [ ] Libraries are composed only through the documented seams (`instrument()`, the `@cendor/core`
      bus, protocols)
- [ ] A framework is described as *working alongside* Cendor — never an "official integration" — and
      nothing claims regulatory compliance (`acttrace` produces *evidence to support* a case)
- [ ] Any Python-only capability is a **documented omission**, not a TypeScript sample that does not
      really work
- [ ] No credential, key, or `.env` in the diff — including inside a committed cassette
- [ ] Commit messages are conventional-ish with a body, and carry **no `Co-Authored-By` trailer**
