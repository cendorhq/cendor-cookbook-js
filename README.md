<h1 align="center">Cendor Cookbook · TypeScript</h1>

<p align="center">
  <a href="https://github.com/cendorhq/cendor-cookbook-js/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/cendorhq/cendor-cookbook-js/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg"></a>
  <a href="https://codespaces.new/cendorhq/cendor-cookbook-js?quickstart=1"><img alt="Open in GitHub Codespaces" src="https://github.com/codespaces/badge.svg"></a>
</p>

Copy-paste **TypeScript** recipes proving [**Cendor**](https://github.com/cendorhq/cendor-libs-js) —
production plumbing for LLM apps (cost, context, testing, governance) — works with the frameworks and
providers you already use. **Every recipe runs offline, with no API key.**

**Written in TypeScript, runnable as plain JavaScript.** Each recipe ships twice: `index.mts` is the
typed source, and the `index.mjs` beside it is generated from it and committed. So
`npx tsx index.mts` gives you the TypeScript, `node index.mjs` runs on Node 20+ with **no build step,
no loader and no toolchain** — and CI proves the two can never drift apart.

Each recipe installs the published `@cendor/*` npm packages and drives them against a fake
provider-shaped client, exactly the way Cendor's own test suite does — so there's nothing to sign up
for and nothing to spend.

> **Looking for Python?** → [**cendorhq/cendor-cookbook**](https://github.com/cendorhq/cendor-cookbook).
> The two cookbooks are **twins, not forks**: a recipe folder name means the same thing in both trees.
> They are separate repos so each has one unambiguous toolchain — a single repo carrying a root
> `pyproject.toml` *and* scattered `package.json` files gives a devcontainer nothing definite to
> provision, and couples two dependency graphs that have no business constraining each other.

## Quickstart

```bash
git clone https://github.com/cendorhq/cendor-cookbook-js
cd cendor-cookbook-js/recipes/quickstarts/core-js
npm install && node index.mjs      # plain JS — no build step
# ...or read/run the TypeScript source it was generated from:
npx tsx index.mts
```

There is **no workspace and no root install**. Every recipe is a self-contained folder with its own
`package.json` — which is the point: it proves the block you copy actually resolves.

## Recipes

| Recipe | Category | What it proves | Packages | Offline |
|---|---|---|---|---|
| [core-js](recipes/quickstarts/core-js/) | quickstart | One `instrument()` wrap → every call on a normalized bus, decimal-safe cost | `@cendor/core` | ✓ |
| [governed-agent-js](recipes/sdk/governed-agent-js/) | **sdk** | A governed agent in ~10 lines — budget + audit + a real tool loop | `@cendor/sdk` | ✓ |
| [m365-custom-engine-js](recipes/agents/m365-custom-engine-js/) | **agent** | Govern a Microsoft 365 Agents SDK **custom engine agent** on `@microsoft/agents-hosting` — plus a negative control for the `afterTurn` trap that silently stops the session cap from ever binding | `@cendor/core` + the six libraries | ✓ |
| [context-under-budget](recipes/combos/context-under-budget/) | **combo** | The clamp binds on the *assembled* prompt: contextkit's receipt **is** the billed input, measured | `core` `contextkit` `squeeze` `tokenguard` | ✓ |
| [compress-and-restore](recipes/combos/compress-and-restore/) | **combo** | A reversible eviction, chained as a metadata-only `compression` audit entry that holds no text | `core` `contextkit` `squeeze` `acttrace` | ✓ |
| [record-a-governed-run](recipes/combos/record-a-governed-run/) | **combo** | Record the governed triad once, replay it at `$0` — proven by a client that throws if reached | `core` `cassette` `tokenguard` `acttrace` | ✓ |
| [break-midstream-audited](recipes/combos/break-midstream-audited/) | **combo** | `onExceed: 'break'` cuts a runaway stream and closes the socket; the cut is chained + verifies | `core` `tokenguard` `acttrace` | ✓ |
| [block-before-record](recipes/combos/block-before-record/) | **combo** | A guardrail block pre-empts the recorder — 2 requests in, 1 call and 1 cassette entry out | `core` `guardrails` `cassette` | ✓ |
| [deterministic-assembly](recipes/combos/deterministic-assembly/) | **combo** | Byte-identical assembly across runs is what makes a replay mean anything (with a hash control) | `core` `contextkit` `cassette` | ✓ |
| [tokenguard-hard-vs-runaway](recipes/libs/tokenguard-hard-vs-runaway/) | library | `clamp` (provider-enforced) vs `break` (mid-flight) — including `break` on a non-stream | `core` `tokenguard` | ✓ |
| [tokenguard-durable-spend](recipes/libs/tokenguard-durable-spend/) | library | `QueueSink` off the hot path + the `BudgetEvent` stream, the only trace a blocked call leaves | `core` `tokenguard` | ✓ |
| [contextkit-eviction-receipt](recipes/libs/contextkit-eviction-receipt/) | library | priority / pin / evict / keep, and the `AssemblyReport` receipt; `whatif()` prices a tighter budget | `core` `contextkit` | ✓ |
| [contextkit-plug-a-compressor](recipes/libs/contextkit-plug-a-compressor/) | library | `useCompressor()` with a domain backend — no base class, no call-site change | `core` `contextkit` `squeeze` | ✓ |
| [squeeze-four-compressors](recipes/libs/squeeze-four-compressors/) | library | json / logs / code / prose × fidelity, with ratios measured on the recipe's own inputs | `core` `squeeze` | ✓ |
| [squeeze-persist-and-restore](recipes/libs/squeeze-persist-and-restore/) | library | `SQLiteStore` + `decompress()` across a **real** process restart, with the MemoryStore failure shown | `core` `squeeze` | ✓ |
| [cassette-four-modes](recipes/libs/cassette-four-modes/) | library | record / replay / rerecord / auto — and why `auto` is wrong for CI | `core` `cassette` | ✓ |
| [cassette-semantic-drift](recipes/libs/cassette-semantic-drift/) | library | Measured: a surface scorer keeps the paraphrase and drops the real change. **Carries the one Python-only omission** | `core` `cassette` | ✓ |
| [acttrace-custom-detector](recipes/libs/acttrace-custom-detector/) | library | `registerDetector()` with a validator + `enableLocalePack()`; 1 of 5 found before, 5 after | `acttrace` | ✓ |
| [core-seams](recipes/libs/core-seams/) | library | `trace()` (a **callback** here), `addStreamObserver()` and `tokens.register()` | `core` | ✓ |
| [acttrace](recipes/quickstarts/acttrace/) | quickstart | A hash-chained record; one flipped byte breaks `verify()` at a named sequence number | `acttrace` | ✓ |
| [cassette](recipes/quickstarts/cassette/) | quickstart | Record once, replay forever — **1 provider call then 0**, which is the whole claim | `core` `cassette` | ✓ |
| [contextkit](recipes/quickstarts/contextkit/) | quickstart | Priority-packed assembly with a receipt; pinned blocks survive, the docs blob truncates | `contextkit` | ✓ |
| [guardrails](recipes/quickstarts/guardrails/) | quickstart | Block + redact **before the wire**, proven from what the provider was actually handed | `core` `guardrails` `acttrace` | ✓ |
| [squeeze](recipes/quickstarts/squeeze/) | quickstart | 83k tokens → 58 against a 400 target, and `expand()` restores byte-for-byte | `core` `squeeze` | ✓ |
| [tokenguard](recipes/quickstarts/tokenguard/) | quickstart | A runaway loop stopped **pre-flight** at a $0.50 cap, with spend attributed per feature | `core` `tokenguard` | ✓ |
| [anthropic](recipes/providers/anthropic/) | **provider** | Three input rates on one call — cache read, cache write, fresh — and why a Claude projection is a projection | `core` + 4 | ✓ |
| [azure-foundry](recipes/providers/azure-foundry/) | **provider** | A deployment name is unpriced, so a USD cap **silently cannot bind** — then one line fixes it | `core` + 4 | ✓ |
| [bedrock](recipes/providers/bedrock/) | **provider** | `send(new ConverseCommand(…))` captured directly; camelCase usage; a token cap that binds with no price at all | `core` + 4 | ✓ |
| [gemini](recipes/providers/gemini/) | **provider** | `usageMetadata`, and a **cumulative** stream: 2000 tokens, not the 3600 a sum would report | `core` + 4 | ✓ |
| [ollama-local](recipes/providers/ollama-local/) | **provider** | A $0 local model — everything governed except the money, and the omission is documented not faked | `core` + 4 | ✓ |
| [openai-chat](recipes/providers/openai-chat/) | **provider** | The whole five-step lifecycle on Chat Completions, with per-feature/per-user attribution | `core` + 4 | ✓ |
| [openai-responses](recipes/providers/openai-responses/) | **provider** | Four usage numbers, not two: cached input and reasoning output are both billed | `core` + 4 | ✓ |
| [custom-category](recipes/governance/custom-category/) | **governance** | A denylist misses the paraphrase; a semantic category catches it | `core` `guardrails` | ✓ |
| [eu-ai-act-evidence](recipes/governance/eu-ai-act-evidence/) | **governance** | An evidence pack where the **refusal** is a first-class record, verified through the CLI | `core` `acttrace` | ✓ |
| [guardrails-policy](recipes/governance/guardrails-policy/) | **governance** | Config-as-data: every decision carries the policy version + hash into the chain | `core` `guardrails` `acttrace` | ✓ |
| [guardrails-redteam](recipes/governance/guardrails-redteam/) | **governance** | A **50%** trip rate, asserted to stay partial — a 100% score means the corpus flatters the gate | `guardrails` | ✓ |
| [intent-gate](recipes/governance/intent-gate/) | **governance** | allow-mode and deny-mode, both directions asserted | `core` `guardrails` | ✓ |
| [llm-judge-guardrail](recipes/governance/llm-judge-guardrail/) | **governance** | Screen with a model and **see the bill for it** — the judge is on the same bus | `core` `guardrails` `cassette` `tokenguard` | ✓ |
| [pii-guardrail](recipes/governance/pii-guardrail/) | **governance** | One detection engine for the gate and the audit trail; `AuditLog` redacts on write too | `core` `guardrails` `acttrace` | ✓ |
| [spotlight-untrusted-docs](recipes/governance/spotlight-untrusted-docs/) | **governance** | Wrap retrieved content as data — and the URL rule still scans inside the wrapper | `core` `guardrails` | ✓ |
| [task-adherence](recipes/governance/task-adherence/) | **governance** | `delete_account` flagged against "book me a flight" — drift, not safety | `core` `guardrails` `cassette` `tokenguard` | ✓ |
| [claude-agent-pretooluse](recipes/bridges/claude-agent-pretooluse/) | **bridge** | A cendor block → `permissionDecision: "deny"`; the SDK's hook types are erased at runtime | `guardrails` | ✓ |
| [langchain-middleware](recipes/bridges/langchain-middleware/) | **bridge** | A cendor block → a `beforeModel` throw, before the model call | `guardrails` | ✓ |
| [mcp-tool-gating](recipes/bridges/mcp-tool-gating/) | **bridge** | A blocked tool returns a **result the model can read**, and the body provably does not run | `guardrails` | ✓ |
| [openai-agents-guardrail](recipes/bridges/openai-agents-guardrail/) | **bridge** | A cendor block → `tripwireTriggered`; a fail-closed block *throws*, so both paths map | `guardrails` | ✓ |
| [azure-foundry-otel](recipes/frameworks/azure-foundry-otel/) | **framework** | Foundry governance as ordinary OTel spans — and two ways to accidentally export nothing | `core` `tokenguard` `acttrace` | ✓ |
| [langchain](recipes/frameworks/langchain/) | **framework** | One callback handler; the chain is unchanged and `provider` honestly reads `langchain` | `core` `tokenguard` `acttrace` | ✓ |
| [llamaindex](recipes/frameworks/llamaindex/) | **framework** | Retrieval score becomes packing priority; contextkit **auto-discovers** squeeze | `core` `contextkit` `squeeze` | ✓ |
| [openai-agents-sdk](recipes/frameworks/openai-agents-sdk/) | **framework** | Spend by **agent**, not just by model — 18× apart on one model | `core` `tokenguard` `acttrace` | ✓ |
| [batch-ingest](recipes/observability/batch-ingest/) | **observability** | Post-hoc accounting for a Batch job — honest that no gate is possible | `core` `tokenguard` | ✓ |
| [otel-export](recipes/observability/otel-export/) | **observability** | Metrics + spans with no Cendor-specific exporter; `outputReserve` is what makes a refusal exportable | `core` `tokenguard` `acttrace` | ✓ |
| [vitest-cassette](recipes/testing/vitest-cassette/) | **testing** | A vitest suite that never calls a provider — and a wrapper that asserts tests actually ran | `core` `cassette` | ✓ |

**52 recipes across 11 categories**, and every one of them has a Python twin of the **same folder
name** in [cendor-cookbook](https://github.com/cendorhq/cendor-cookbook). Each recipe's README links
to its own twin.

Four folder names are exceptions, and they are exceptions on purpose:

| here | Python twin | why |
|---|---|---|
| `quickstarts/core-js` | `quickstarts/core` | historical — from before the two cookbooks were split. Renaming it now would break a cendor.ai deep link and the MCP index |
| `sdk/governed-agent-js` | `sdk/governed-agent` | same |
| `agents/m365-custom-engine-js` | `agents/m365-custom-engine-py` | same |
| `testing/vitest-cassette` | `testing/pytest-cassette` | **deliberate.** `pytest` is a Python toolchain name; the twin genuinely *is* a different test runner, so the name says so |

### The one recipe with no TypeScript twin

| Python recipe | Why there is no twin here |
|---|---|
| [`apps/chat-playground`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/apps/chat-playground) | It is a **Gradio** app, and Gradio is Python-only. A TypeScript port would be a *different application* wearing a twin's folder name — which is worse than an honest gap, because the folder name is an API that cendor.ai deep-links and the MCP docs server indexes. |

That is the complete list. Everything else in the Python cookbook is here.

## Run any recipe

```bash
cd recipes/<category>/<name>
npm install
node index.mjs        # or: npx tsx index.mts
```

Every category above has a matching shard in [`.github/workflows/ci.yml`](.github/workflows/ci.yml),
and `scripts/check-recipe-coverage.mjs` fails the build if a category ever escapes it — that is what
backs the "every recipe runs offline" claim.

## TypeScript source, JavaScript product

`index.mts` is what you edit; `index.mjs` is **generated from it and committed**. Two reasons it
works this way rather than shipping only one of them:

- **A plain-JS reader owes nothing to a toolchain.** `node index.mjs` runs as-is on Node 20 — the
  oldest version in the CI matrix, which cannot execute TypeScript at all. No `tsx`, no `tsc`, no
  loader flag, nothing added to the recipe's `package.json`.
- **A TypeScript reader gets types that are actually checked.** Every `.mts` is typechecked under
  `strict` against the **real published `@cendor/*` types** in CI, on both Node versions. The same
  property `pnpm check:docs` gives the docs, the cookbook now has too.

**Never hand-edit an `index.mjs`.** `scripts/check-ts-js-sync.mjs` regenerates every file and fails
on one differing byte, so an edit there is reverted by the next build and rejected by CI in between.
Edit the `.mts` and regenerate — see [Optional dev tooling](#optional-dev-tooling).

The generator erases types with [ts-blank-space](https://github.com/bloomberg/ts-blank-space) and
formats the result with biome, rather than emitting through `tsc` — `tsc` re-prints from the AST and
drops every blank line, which is fine for build output and wrong for a file people are meant to
read. `tsc` still does the typechecking; only the emitter is replaced.

## How offline works

`instrument()` identifies an LLM client by its **shape**, not by network access — so a plain object
with the same `chat.completions.create` / `responses.create` / `messages.create` / `chat(...)`
surface is all it needs. The fake returns a canned `usage`, and Cendor normalizes and prices it from
a bundled offline snapshot exactly as it would a real call. No SDK, no key, no daemon.

Where a recipe's *point* is a real model call, the exchange is recorded once into a small JSON
cassette that is committed, and every run after that replays it.

Costs shown anywhere come from `prices.estimate` on the stated token counts — no invented numbers,
and money is `decimal.js`, never a float.

## Node versions

CI runs every recipe on **Node 20 and Node 22**. That matrix is deliberate: `AsyncLocalStorage`
behaves differently on legacy-ALS Node than it does on 24, and `@cendor/core` once shipped a real bug
that was invisible on the newest Node. A recipe green only on 24 proves nothing about the LTS.

## Optional dev tooling

**You need none of this to use the cookbook.** Clone, `npm install` in a recipe, `node index.mjs` —
that is the whole contract, and nothing below changes it. This section is for the two cases where
extra tooling actually earns its place: *changing* a recipe, and *writing your own* Cendor code.

### To change a recipe — the maintainer toolchain

Lives in [`scripts/`](scripts/), with its own manifest. It is **not** a workspace and no recipe ever
resolves anything from it.

```bash
npm install --prefix scripts                     # tsc + ts-blank-space + biome + @types/node

node scripts/build-recipes.mjs                   # typecheck every .mts, rewrite every .mjs
node scripts/build-recipes.mjs recipes/libs/…    # …or just one recipe

node scripts/check-ts-js-sync.mjs                # committed .mjs == what its .mts generates
node scripts/check-ts-js-sync.mjs --self-test    # the gate's own negative control
node scripts/check-recipe-coverage.mjs           # every recipe reachable from the CI matrix
node scripts/check-live-switches.mjs             # every README "Live switch:" claim matches the code
node scripts/check-one-core.mjs recipes/<cat>/<name>
```

`@types/node` lives here rather than in the 52 recipe manifests on purpose: it is a **typecheck**
dependency, never a runtime one — `node index.mjs` has never needed it — so putting it in the pins a
reader copies would misrepresent what the recipe actually requires.

⚠️ **Those four versions are pinned EXACTLY, and that is deliberate.** `check-ts-js-sync` compares
*generated bytes*, so a caret range would let two machines produce two different files from one
source and each call the other wrong. A dependabot bump to tsc, biome or ts-blank-space can therefore
turn CI red legitimately — the fix is never to loosen the gate, it is to bump **and** re-run
`node scripts/build-recipes.mjs`, committing the regenerated `.mjs` in the same change.

⚠️ **To reproduce what CI installs, delete the lockfile too.** This repo commits no lockfile *to
git*, but `npm install` still writes `package-lock.json` locally and every later install honours it —
so `rm -rf node_modules` alone faithfully reinstalls the shelf you already had, not the published
one. CI clones fresh and has none:

```bash
rm -rf recipes/<cat>/<name>/{node_modules,package-lock.json} && (cd recipes/<cat>/<name> && npm install)
```

### To write your own Cendor code

Both are optional, offline, and **no library depends on either** — they exist to make a *consumer's*
repo easier to get right, and neither is needed to run anything here.

| Tool | What it does |
|---|---|
| [`npx @cendor/init`](https://cendor.ai/docs/assistant-init) | Makes your own repo Cendor-ready: writes the assistant rules file(s), optionally adds the MCP config (`--mcp`) and scaffolds a correct `instrument()` call (`--scaffold`). Idempotent — marker-delimited blocks, never clobbers your content. `npx @cendor/init doctor` static-checks the wiring and exits non-zero on hard problems, so it fits CI. |
| [`npx @cendor/mcp`](https://cendor.ai/mcp) | A read-only MCP docs server, so an agent-mode assistant answers with Cendor's **real** call shapes instead of guessing. Remote `mcp.cendor.ai`, or local over stdio. `list_recipes` enumerates both cookbooks' categories. |

If you are wiring Cendor into a coding assistant, start at
[cendor.ai/docs/for-ai-assistants](https://cendor.ai/docs/for-ai-assistants) — the call-shape trap
sheet and the paste-in rules files.

## Parity with the Python cookbook

Most recipes exist in both cookbooks. Where a capability is **Python-only**, the TypeScript side
carries a *documented omission* rather than a sample that does not really work — the parity matrix
([`cendor-libs-js/docs/parity.md`](https://github.com/cendorhq/cendor-libs-js/blob/main/docs/parity.md))
is the contract.

| Capability | Status in TypeScript | Where it bites |
|---|---|---|
| `localEmbeddingScorer` (model2vec static embeddings) | **Python-only.** The symbol exists and throws by design, so the failure is immediate and named rather than a missing export. Wire your own embedder through `embeddingScorer(embedFn)` instead | any recipe scoring semantic similarity offline |
| acttrace NER (Presidio) | **Not equivalent.** Python uses Presidio (spaCy transformer models); TypeScript uses the **optional** `compromise` peer, which is English-only, synchronous, and has **lower recall** on free-text names/places/orgs. A useful extra layer, **not** a sufficient sole PII control in either language. The regex + validator catalogue underneath it *is* identical | [`governance/pii-guardrail`](recipes/governance/pii-guardrail/) |
| `SQLiteStore` / `SQLiteSink` | Present and **identically cased**, but backed by the **optional native** `better-sqlite3`. Measured 2026-07-31: that package publishes **no prebuilt binary for Node 20 on linux-x64**, so anything depending on it is green on Node 22 and red on Node 20 unless a C++ toolchain is present. Both persistence recipes here therefore use a hand-written backend and say so | [`libs/squeeze-persist-and-restore`](recipes/libs/squeeze-persist-and-restore/), [`libs/tokenguard-durable-spend`](recipes/libs/tokenguard-durable-spend/) |

| `semanticMatch` default scorer | **Lexical in both**, but Python can also reach for `localEmbeddingScorer`. Measured: a reword scores 0.75 (passes at the 0.6 default) while a true paraphrase scores 0.51 and **fails**. Pass `openaiEmbeddingScorer(...)` for real paraphrase tolerance | [`testing/vitest-cassette`](recipes/testing/vitest-cassette/), [`quickstarts/cassette`](recipes/quickstarts/cassette/) |
| `messages.stream()` / `messages.parse()` / `responses.parse()` | **Deliberately NOT instrumentation targets in TypeScript.** In the JS SDKs they are helpers built on `create`, so a target would double-count one request. Python is the opposite — each POSTs its own request and needs its own target | [`providers/anthropic`](recipes/providers/anthropic/), [`providers/openai-responses`](recipes/providers/openai-responses/) |

Everything else the recipes here touch — `QueueSink`, `useCompressor`, `registerDetector`,
`enableLocalePack`, `addStreamObserver`, `tokens.register`, `trace` — is fully ported. Note the
shapes differ where the language does: `trace(id, fn)` is a callback in TypeScript, `assemble()` is
async, `withBudget(cfg, cb)` is the scope form (never `budget(cfg, fn)`), and a stream is aborted by
**IteratorClose** (`return()`) rather than Python's `close()`.

✅ One constraint **found by writing these recipes and since fixed**: on `@cendor/tokenguard` 3.0.2 the
whole `@cendor/tokenguard/sinks` subpath could not be imported when the optional `better-sqlite3` was
skipped at install time — a value import of it at module scope took `QueueSink` and `OTelSink` down
with `SQLiteSink`, *after a successful `npm install`*. Fixed in **3.1.0** (lazy `createRequire`, pinned
by a regression test with a negative control), verified on the published package in a clean
`node:20-slim` container: the subpath imports, `QueueSink` works, and `SQLiteSink` throws only when
you actually construct one. `libs/tokenguard-durable-spend` uses the real `QueueSink`.

## Contributing

New recipes are welcome — the one hard rule is **it runs green offline, with no key**. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the recipe template and the offline bar.

Also: [Code of Conduct](CODE_OF_CONDUCT.md) · [Security policy](SECURITY.md) — **never** open a public
issue for a security problem; report it privately through the Security tab.

## Links

- **Python cookbook:** [github.com/cendorhq/cendor-cookbook](https://github.com/cendorhq/cendor-cookbook)
- **Libraries:** [github.com/cendorhq/cendor-libs-js](https://github.com/cendorhq/cendor-libs-js) ·
  **SDK:** [github.com/cendorhq/cendor-sdk-js](https://github.com/cendorhq/cendor-sdk-js)
- **Site:** [cendor.ai](https://cendor.ai) · [cendor.ai/cookbook](https://cendor.ai/cookbook)
- **Docs:** [cendor.ai/docs](https://cendor.ai/docs)
- **MCP server:** [cendor.ai/mcp](https://cendor.ai/mcp) · **init CLI:**
  [cendor.ai/docs/assistant-init](https://cendor.ai/docs/assistant-init) — both optional, see
  [Optional dev tooling](#optional-dev-tooling).
- **For AI assistants:** [cendor.ai/docs/for-ai-assistants](https://cendor.ai/docs/for-ai-assistants) —
  the call-shape trap sheet + paste-in rules files for wiring Cendor into your coding assistant.

## License & disclaimer

Apache-2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). Copyright © 2026 Raghav Mishra (PowerAI Labs).

> Provided **"AS IS", without warranties of any kind**; the authors carry no liability for use —
> see Apache-2.0 §7–§8. In particular, `acttrace` produces **evidence to support** compliance —
> not a guarantee, and not legal advice.
