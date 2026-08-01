# ollama-local (JS) — a $0 local model, and the one step that cannot be honest

**The pain.** You move a workload to a local model to stop paying for it, and your governance stack
quietly stops meaning anything. A USD cap on a model nobody bills you for is a control that can
never fire — but it still *looks* enforced in the code.

**What this shows.** The whole lifecycle against a local daemon, with the cost step **documented as
an omission instead of faked**.

## The five steps, in order

Every recipe in `providers/` walks the same five, so you can read one and then skim the rest:

| # | step | what it is here |
|---|---|---|
| 1 | **connect** | the provider's own client, untouched |
| 2 | **instrument** | one `instrument(client)` wrap — detection is *structural*, never by class name, which is why the offline fake is recognised exactly like the real thing |
| 3 | **govern** | a `@cendor/tokenguard` cap (pre-flight) **and** one `@cendor/guardrails` gate |
| 4 | **record** | `@cendor/cassette` — the same call replayed offline: 0 provider calls, $0 |
| 5 | **prove** | `@cendor/acttrace` `verify()` over the hash chain, and a cost from `prices` |

**What is DISTINCTIVE here: the cost step is the one that cannot be honest.** A local model has no
invoice. Some ids carry a `$0.00` row in the bundled snapshot (`llama3`); most carry no row at all
(`llama3.2:latest`), and `call.cost` is then `null`. Both are correct answers. Neither is a number
you can budget against.

**So cap tokens, not dollars.** A token cap needs no rate and binds identically either way.

## Run it

```bash
cd recipes/providers/ollama-local
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
gate      : BLOCKED by keyword_deny (input) - denied keyword: "ignore previous instructions"
            the daemon saw 0 call(s) — a gate is not about money
budget    : token cap bound — BudgetExceeded
            4 call(s) ran under an 8,000-token cap
cost      : $0 (a $0.00 snapshot row — a local model has no invoice)
tokens    : 1800 in + 240 out — EXACT either way
cassette  : replayed 1 call, 0 provider call(s)
verify()  : true - ok: 10 entries, head e9957e04ca95… (signatures verified)
```

**`tokens … EXACT either way`** is the point. Everything except the money is fully governed on a
local model: the gate, the token cap, the cassette, the tamper-evident chain.

## The assertion this recipe is careful about

The obvious cost assertion is a trap:

```js
assert.ok(cost == null || cost.amount.isZero() || cost.amount.gt(0));   // ✗ always true
```

That covers every possible value and can never fail. What the recipe actually asserts is that a
local model costs `null` **or exactly zero** — so if something ever invents a rate for a model
nobody bills you for, the recipe goes red instead of quietly printing it.

## The shape that differs from Python

⚠️ **`chat` is a method on the client itself** (`new Ollama().chat`), not nested under
`chat.completions`, which is how `instrument()` tells an Ollama client apart. Nothing else changes.

## Honest limits

There is no cost claim here, on purpose. Local inference is not free — it costs you hardware,
electricity and latency — but none of that is a per-token rate any library can read, so Cendor
reports what it knows and stays quiet about the rest.

## Going live

```bash
ollama pull llama3
OLLAMA_LIVE=1 node index.mjs
OLLAMA_MODEL=llama3.2 OLLAMA_LIVE=1 node index.mjs     # a different local model
```

No key, and no cloud — the "live" path here just talks to `localhost`.

Python twin: [`providers/ollama-local`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/providers/ollama-local) ·
Packages: `@cendor/acttrace`, `@cendor/cassette`, `@cendor/core`, `@cendor/guardrails`, `@cendor/tokenguard`, `ollama` · Offline ✓ · Live switch: `OLLAMA_LIVE=1` · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/acttrace    ^3.1.0
@cendor/cassette    ^3.0.0
@cendor/core        ^3.4.0
@cendor/guardrails  ^3.1.0
@cendor/tokenguard  ^3.1.0
ollama              ^0.6.3
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
