# tokenguard-durable-spend (JS) — spend that survives a restart, off the hot path

**The pain.** `report()` aggregates in memory, which is perfect for a test and useless for a service:
restart the process and the month's spend is gone. So you write the rows to a database — and now every
model call waits on your disk, because the bus fans out to subscribers **inline**.

**What this shows.** `QueueSink` wraps **any** sink so its writes run on a background worker: `write()`
enqueues and returns immediately, and the worker drains the queue into the inner sink **in order**,
with bounded back-pressure and drop accounting.

```js
useSink(new QueueSink(mySink));
```

The inner sink is core's `Sink` protocol and nothing more — `write(entry)`, plus optional `flush()` /
`close()`. Small enough to show whole, so the recipe writes its own nine-line JSONL one rather than
reaching for the bundled `SQLiteSink` (see the note below).

Durability is opt-in at shutdown, and that is deliberate: a background worker means an abrupt exit can
lose queued rows. `flush()` waits until the queue is empty; `close()` flushes and releases.

It also counts `BudgetEvent`s off the same bus — the **only** signal a blocked call leaves, because a
call refused pre-flight never becomes an `LLMCall` and so never reaches a sink at all.

## Run it

```bash
cd recipes/libs/tokenguard-durable-spend
npm install
node index.mjs
```

## Expected output

```text
persisted rows   : 3 in spend.jsonl (362 bytes)
  {"tenant":"acme"}    $0.0045  1000 in / 200 out
  {"tenant":"acme"}    $0.0045  1000 in / 200 out
  {"tenant":"globex"}  $0.0045  1000 in / 200 out
in-memory report : acme $0.009 over 2 calls, globex $0.0045
budget events    : 1 - action='blocked', cap=10 tokens (a blocked call emits no LLMCall, so this is the ONLY signal)
shutdown         : flush() drained the queue before close() - a background worker would otherwise leave rows unwritten on an abrupt exit
```

Four calls were attempted and **three** rows persisted. The fourth was blocked pre-flight, so there is
no spend row for it — correct, because no money was spent, and exactly why you also watch the
`BudgetEvent` stream. Alerting on "spend went up" cannot tell you the breaker fired.

The rows are read back from the file, the way a *different* process would. Note `usd` arrives as a
**string** (`"0.0045"`) — the Decimal serialised without going through a float. The recipe asserts
that, and asserts `QueueSink` preserved write order.

Call shapes: `useSink` (camelCase); `QueueSink` from the **`@cendor/tokenguard/sinks` subpath**; and
`event.capTokens` on a `BudgetEvent` (class fields are camelCase, while the spend rows a sink receives
keep the snake_case wire keys — `input_tokens`, `output_tokens`).

## Why the inner sink is hand-written rather than `SQLiteSink`

`@cendor/tokenguard/sinks` also ships an `SQLiteSink`, and the Python twin uses its equivalent. It is
backed by the **optional native `better-sqlite3`** — and measured 2026-07-31, that package publishes
**no prebuilt binary for Node 20 on linux-x64**:

```text
prebuild-install warn install No prebuilt binaries found (target=20.20.2 runtime=node arch=x64 libc= platform=linux)
gyp ERR! find Python  Could not find any Python installation to use
```

The same install succeeds on `node:22-slim` in 7 seconds, so anything *depending* on it is green on
Node 22 and red on Node 20 unless a C++ toolchain is present. A copy-paste recipe should not need one.
Python's twin has no such constraint — it uses the stdlib `sqlite3` and needs nothing.

`SQLiteSink` is still the right choice in your own app if you already build native modules. Since
**`@cendor/tokenguard` 3.1.0** it fails only when you actually *construct* one, which is the correct
time to find out:

```text
SQLiteSink throws only when CONSTRUCTED: MODULE_NOT_FOUND
```

> **A note on where that behaviour came from — this recipe found the bug.** On `@cendor/tokenguard`
> 3.0.2, `dist/sinks.js` carried a **value** import of `better-sqlite3` at module scope. npm silently
> *skips* an optionalDependency it cannot build, so `npm install` **succeeded** and then the first
> `import … from '@cendor/tokenguard/sinks'` threw `ERR_MODULE_NOT_FOUND` — taking `QueueSink` and
> `OTelSink`, neither of which touches SQLite, down with `SQLiteSink`. Writing this recipe on Node 20
> is what surfaced it. Fixed in 3.1.0 with the pattern `@cendor/squeeze`'s `store.ts` already used
> (`import type` + a `createRequire` load inside the constructor) and pinned by a regression test whose
> negative control was verified red first. Verified on the published 3.1.0 in a clean `node:20-slim`
> container with `better-sqlite3` absent: the subpath imports, `QueueSink` works, `SQLiteSink` throws
> only on construction.

Python twin: [`libs/tokenguard-durable-spend`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/libs/tokenguard-durable-spend) ·
Packages: `@cendor/core`, `@cendor/tokenguard` · Offline ✓ · [← all recipes](../../../README.md)
