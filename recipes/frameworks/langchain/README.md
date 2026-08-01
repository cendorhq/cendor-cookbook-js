# langchain (JS) — govern a LangChain run without changing the chain

**The pain.** Your LangChain chain works. You need cost attribution, a budget and an audit trail on
it — and every option seems to involve rewriting the chain or wrapping every model.

**What this shows.** LangChain already has a callback system, so Cendor patches nothing. Attach
`CendorCallbackHandler` and every LLM call LangChain makes lands on core's bus as a normalized
`LLMCall`: priced, budgeted, and chained into an audit trail like any other call.

LangChain *works alongside* Cendor. It is not an official integration.

## Run it

```bash
cd recipes/frameworks/langchain
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
langchain calls captured : 2 (attach one handler; change nothing else)
model / provider         : gpt-4o / langchain
usage                    : 1400 in + 180 out
spend by feature         : 2 calls  $0.00875
audit entries chained    : 2 llm_call
verify()                 : true - ok: 3 entries, head f042715ccbce…
```

`provider` reads **`langchain`**, not `openai` — the call came through the callback surface, and the
record says so rather than guessing at the underlying vendor.

## The whole integration

```js
import { CendorCallbackHandler } from '@cendor/core/langchain';
const handler = new CendorCallbackHandler();
await chain.invoke(input, { callbacks: [handler] });
```

## The shape that differs from Python

⚠️ **`tokenUsage` is camelCase in langchain-js** and `token_usage` in Python LangChain. The handler
reads both, so nothing in your code changes — but if you are writing a fake for a test, that is the
key it will look for.

## Honest limits

The handler sees what LangChain reports. A LangChain integration that does not populate
`llmOutput.tokenUsage` gives you a call with no usage — the record will say so (cost `null`) rather
than estimate one.

Python twin: [`frameworks/langchain`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/frameworks/langchain) ·
Packages: `@cendor/acttrace`, `@cendor/core`, `@cendor/tokenguard`, `@langchain/core` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/core        ^3.4.0
@cendor/tokenguard  ^3.1.0
@cendor/acttrace    ^3.1.0
@langchain/core     ^1.2.4
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
