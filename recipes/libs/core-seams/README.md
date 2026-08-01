# core-seams (JS) — the three hooks every other Cendor library is built on

**The pain.** You want one of the things Cendor does, but not quite the way it does it — spend grouped
by *your* run id, a per-chunk latency meter, a token count for a model nobody bundles a tokenizer for.
Normally that means forking, or patching the client a second time and hoping the two patches agree.

**What this shows.** `@cendor/core` is deliberately small: it normalizes provider calls onto one bus
and exposes a handful of seams. Every other library in the set is *just a subscriber* — so the same
seams are open to you.

| seam | what it does |
|---|---|
| `trace(id, fn)` | group a unit of work: every `LLMCall`/`ToolCall` inside carries `traceId=id`, and with OpenTelemetry configured they become children of **one** parent span |
| `addStreamObserver(fn)` | `fn(call, deltaText, deltaThinking)` per chunk of every instrumented stream. Core extracts the deltas, so an observer never parses a provider shape. **Throwing aborts the stream** |
| `tokens.register(fam, fn)` | override the token counter for a model family — a fine-tune, a local model, a vendor with its own BPE |

## Run it

```bash
cd recipes/libs/core-seams
npm install
node index.mjs
```

## Expected output

```text
trace()          : currentTraceId() inside the scope = "order-8812-refund"
                   2 of 3 calls carry it; the one outside has traceId=""
stream observer  : 12 chunk deltas seen for 12 chunks consumed, first delta "part 0 "
                   throwing inside the observer CLOSES the provider stream - that is how tokenguard's break works
tokens.register(): acme-llm-1 family="default"
                   before 9 tokens (method "bpe-estimate") -> after 21 tokens (method "registered")
                   every budget, receipt and estimate downstream now uses your counter
```

**`addStreamObserver` is not a logging hook — it is an enforcement seam.** Throwing from it closes the
provider stream, finalizes the `LLMCall` with a partial estimated usage, and propagates to the
consumer. That is *exactly* how `onExceed: 'break'` is implemented, and core learns no budget
vocabulary in the process. With zero observers registered it costs one length check per chunk.

**`tokens.method()` tells you how confident to be** — `registered` (your counter), `exact` (a
model-native tiktoken encoding), `bpe-estimate` (an o200k proxy) or `heuristic`. Surface it rather than
presenting an estimate as a count.

⚠️ **`family()` maps an id to a family, and an unrecognised id lands in `"default"`** — so registering
there also covers every *other* unrecognised model in the process.

## The one shape that differs from Python

`trace` is a **callback** in TypeScript and a context manager in Python:

```js
await trace('order-8812-refund', async () => { /* … */ });   // TS
```
```python
with trace("order-8812-refund"):   # Python
    ...
```

Same seam, same `traceId` on every event inside, same parent span. Every number in the output above
matches the Python twin.

Python twin: [`libs/core-seams`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/libs/core-seams) ·
Packages: `@cendor/core` · Offline ✓ · Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/core  ^3.4.0
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
