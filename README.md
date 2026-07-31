<h1 align="center">Cendor Cookbook · TypeScript</h1>

<p align="center">
  <a href="https://github.com/cendorhq/cendor-cookbook-js/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/cendorhq/cendor-cookbook-js/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg"></a>
  <a href="https://codespaces.new/cendorhq/cendor-cookbook-js?quickstart=1"><img alt="Open in GitHub Codespaces" src="https://github.com/codespaces/badge.svg"></a>
</p>

Copy-paste **TypeScript** recipes proving [**Cendor**](https://github.com/cendorhq/cendor-libs-js) —
production plumbing for LLM apps (cost, context, testing, governance) — works with the frameworks and
providers you already use. **Every recipe runs offline, with no API key.**

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
npm install && node index.mjs
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

Every recipe above has a Python twin of the same folder name in
[cendor-cookbook](https://github.com/cendorhq/cendor-cookbook), except `core-js`,
`governed-agent-js` and `m365-custom-engine-js`, whose twins drop the `-js` suffix
(`quickstarts/core`, `sdk/governed-agent`, `agents/m365-custom-engine-py`). Each recipe's README
links to its own twin.

## Run any recipe

```bash
cd recipes/<category>/<name>
npm install
node index.mjs
```

Every category above has a matching shard in [`.github/workflows/ci.yml`](.github/workflows/ci.yml),
and `scripts/check-recipe-coverage.mjs` fails the build if a category ever escapes it — that is what
backs the "every recipe runs offline" claim.

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

## Parity with the Python cookbook

Most recipes exist in both cookbooks. Where a capability is **Python-only**, the TypeScript side
carries a *documented omission* rather than a sample that does not really work — the parity matrix
([`cendor-libs-js/docs/parity.md`](https://github.com/cendorhq/cendor-libs-js/blob/main/docs/parity.md))
is the contract.

| Capability | Status in TypeScript | Where it bites |
|---|---|---|
| `localEmbeddingScorer` (model2vec static embeddings) | **Python-only.** The symbol exists and throws by design, so the failure is immediate and named rather than a missing export. Wire your own embedder through `embeddingScorer(embedFn)` instead | any recipe scoring semantic similarity offline |
| acttrace NER (Presidio) | **Python-only.** TypeScript uses the bundled `compromise` NER, which is always available and needs no heavy extra | detector-heavy redaction recipes |
| `SQLiteStore` / `SQLiteSink` | Present and **identically cased**, but backed by the **optional native** `better-sqlite3`. Measured 2026-07-31: that package publishes **no prebuilt binary for Node 20 on linux-x64**, so anything depending on it is green on Node 22 and red on Node 20 unless a C++ toolchain is present. Both persistence recipes here therefore use a hand-written backend and say so | [`libs/squeeze-persist-and-restore`](recipes/libs/squeeze-persist-and-restore/), [`libs/tokenguard-durable-spend`](recipes/libs/tokenguard-durable-spend/) |

Everything else the recipes here touch — `QueueSink`, `useCompressor`, `registerDetector`,
`enableLocalePack`, `addStreamObserver`, `tokens.register`, `trace` — is fully ported. Note the
shapes differ where the language does: `trace(id, fn)` is a callback in TypeScript, `assemble()` is
async, `withBudget(cfg, cb)` is the scope form (never `budget(cfg, fn)`), and a stream is aborted by
**IteratorClose** (`return()`) rather than Python's `close()`.

⚠️ One further constraint, found by writing these recipes: on **`@cendor/tokenguard` 3.0.2 the whole
`@cendor/tokenguard/sinks` subpath cannot be imported** when the optional `better-sqlite3` was skipped
at install time — a value import of it at module scope took `QueueSink` and `OTelSink` down with
`SQLiteSink`. Fixed in `cendor-libs-js` (lazy `createRequire`, pinned by a regression test) and
awaiting release as **3.0.3**; until then `libs/tokenguard-durable-spend` hand-rolls the queue and
explains why.

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
- **MCP server:** [cendor.ai/mcp](https://cendor.ai/mcp) — an agent-mode assistant can list both
  cookbooks' recipe categories with the `list_recipes` tool (remote `mcp.cendor.ai` or local
  `npx @cendor/mcp` / `uvx cendor-mcp`).
- **For AI assistants:** [cendor.ai/docs/for-ai-assistants](https://cendor.ai/docs/for-ai-assistants) —
  the call-shape trap sheet + paste-in rules files for wiring Cendor into your coding assistant.

## License & disclaimer

Apache-2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). Copyright © 2026 Raghav Mishra (PowerAI Labs).

> Provided **"AS IS", without warranties of any kind**; the authors carry no liability for use —
> see Apache-2.0 §7–§8. In particular, `acttrace` produces **evidence to support** compliance —
> not a guarantee, and not legal advice.
