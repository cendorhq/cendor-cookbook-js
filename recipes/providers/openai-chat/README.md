# openai-chat (JS) — the whole governed lifecycle on Chat Completions

**The pain.** `chat.completions.create` is the shape most production code still calls. Governing it
usually means three separate integrations — one for cost, one for safety, one for the audit trail —
each patching the client in its own way and none of them agreeing about what happened.

**What this shows.** One `instrument()` wrap, and the budget, the gate, the recorder and the audit
chain all see the same normalized event.

## The five steps, in order

Every recipe in `providers/` walks the same five, so you can read one and then skim the rest:

| # | step | what it is here |
|---|---|---|
| 1 | **connect** | the provider's own client, untouched |
| 2 | **instrument** | one `instrument(client)` wrap — detection is *structural*, never by class name, which is why the offline fake is recognised exactly like the real thing |
| 3 | **govern** | a `@cendor/tokenguard` cap (pre-flight) **and** one `@cendor/guardrails` gate |
| 4 | **record** | `@cendor/cassette` — the same call replayed offline: 0 provider calls, $0 |
| 5 | **prove** | `@cendor/acttrace` `verify()` over the hash chain, and a cost from `prices` |

**What is DISTINCTIVE here: per-feature attribution.** `track({ feature, user_id }, fn)` tags a
call; `report(['feature', 'user_id'])` turns the tags into a spend table. That is the answer to
"which feature spent it", and it costs one wrapper.

## Run it

```bash
cd recipes/providers/openai-chat
npm install
node index.mjs
```

## Expected output

```text
gate      : BLOCKED by keyword_deny (input) - denied keyword: "ignore previous instructions"
            provider saw 0 call(s) => $0 spent on it
budget    : BudgetExceeded - blocked pre-flight, no call ran
spend     : by feature/user
            {"feature":"support_bot","user_id":"user-42"} 5 calls  $0.45
            TOTAL 5 calls  $0.45
cassette  : replayed 1 call, 0 provider call(s), $0
verify()  : true - ok: 12 entries, head bdcd2f7885a0…
```

## The shapes that differ from Python

⚠️ **`budget` is curried** — `budget(cfg)(fn)`, never `budget(cfg, fn)`. ⚠️ **`track(tags, fn)`
takes a callback**, and it is async. ⚠️ **`audit.decision(cb, opts)` takes the callback FIRST**.
⚠️ **`report()` rows live on `.rows`**, and tag keys stay snake_case on the wire.

## Honest limits

⚠️ The `$0.45` and the "5 calls" are properties of **this fixture**, not of gpt-4o. The fake reports
6,000 output tokens per call; a real gpt-4o reply to this prompt is ~50, so against a live key the
same $0.50 cap survives far longer. `outputReserve` governs the pre-flight *projection*; settled
usage governs the *record*. They are meant to differ — set your cap from a measured per-turn cost.

## Going live

```bash
RECORD=1 OPENAI_API_KEY=sk-... node index.mjs
```
Records a real cassette into `fixtures/`. CI never runs this path and this repo has no secrets.

Python twin: [`providers/openai-chat`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/providers/openai-chat) ·
Packages: `@cendor/acttrace`, `@cendor/cassette`, `@cendor/core`, `@cendor/guardrails`, `@cendor/tokenguard`, `openai` · Offline ✓ · Live switch: `RECORD=1` · [← all recipes](../../../README.md)
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
openai              ^7.3.0
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
