# gemini (JS) — a usage shape that shares nothing with OpenAI, and a cumulative stream

**The pain.** You add Gemini beside your OpenAI path and every cost dashboard reads zero. There is
no `usage` key at all — it is `usageMetadata`, camelCase, with different field names. And if you
stream, naively summing the chunks over-counts by a factor that grows with the response length.

**What this shows.** Both normalized onto the same bus, with the streaming trap measured in the
recipe's own output.

## The five steps, in order

Every recipe in `providers/` walks the same five, so you can read one and then skim the rest:

| # | step | what it is here |
|---|---|---|
| 1 | **connect** | the provider's own client, untouched |
| 2 | **instrument** | one `instrument(client)` wrap — detection is *structural*, never by class name, which is why the offline fake is recognised exactly like the real thing |
| 3 | **govern** | a `@cendor/tokenguard` cap (pre-flight) **and** one `@cendor/guardrails` gate |
| 4 | **record** | `@cendor/cassette` — the same call replayed offline: 0 provider calls, $0 |
| 5 | **prove** | `@cendor/acttrace` `verify()` over the hash chain, and a cost from `prices` |

**What is DISTINCTIVE here: a different shape, and a cumulative stream.**

| OpenAI | Gemini |
|---|---|
| `usage.prompt_tokens` | `usageMetadata.promptTokenCount` |
| `usage.completion_tokens` | `usageMetadata.candidatesTokenCount` |
| `create({ …, stream: true })` | a **separate method**, `generateContentStream` |
| each chunk carries a **delta** | each chunk carries the **running total** |

## Run it

```bash
cd recipes/providers/gemini
npm install
node index.mjs
```

## Expected output

```text
gate      : BLOCKED by keyword_deny (input) - denied keyword: "ignore previous instructions"
            provider saw 0 call(s) => $0 spent on it
budget    : BudgetExceeded - blocked pre-flight, no call ran
spend     : 54 calls  $0.4968 (usageMetadata normalized onto the same bus)
stream    : 3 chunks, each reporting the RUNNING total (400 -> 1200 -> 2000)
            recorded output = 2000, not 3600 — the last value wins, sums do not
cassette  : replayed 1 call, 0 provider call(s), $0
verify()  : true - ok: 61 entries, head 61d4c5e9a6c6… (signatures verified)
```

⚠️ **`2000, not 3600`** is the line to read twice. Three chunks reporting 400, 1,200 and 2,000 mean
the answer was 2,000 tokens. Summing them gives 3,600 — an 80% over-count on a three-chunk response,
and it gets worse the longer the stream. `instrument()` takes the last value.

## The shapes that differ from Python

⚠️ **Streaming is its own method**, so it is its own instrumentation target (`google_stream`). There
is no `stream: true` flag to set. ⚠️ The JS SDK returns **camelCase** usage
(`usageMetadata.promptTokenCount`) where the Python SDK returns snake_case
(`usage_metadata.prompt_token_count`) — core reads both, so nothing in your code changes.
⚠️ There is no `client.aio` surface in JS; the single async surface is `client.models`.

## Honest limits

Gemini's own token counts are what is recorded. The pre-flight *projection* uses an o200k proxy,
which is not Gemini's tokenizer — check `tokens.method(model)` to see which you are getting. As
everywhere in Cendor: settled usage is exact, a projection is a projection.

## Going live

```bash
RECORD=1 GOOGLE_API_KEY=... node index.mjs        # GEMINI_MODEL optional
```

Python twin: [`providers/gemini`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/providers/gemini) ·
Packages: `@cendor/acttrace`, `@cendor/cassette`, `@cendor/core`, `@cendor/guardrails`, `@cendor/tokenguard`, `@google/genai` · Offline ✓ · Live switch: `RECORD=1` · [← all recipes](../../../README.md)
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
@google/genai       ^2.15.0
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
