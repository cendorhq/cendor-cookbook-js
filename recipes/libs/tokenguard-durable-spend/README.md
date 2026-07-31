# tokenguard-durable-spend (JS) — spend that survives a restart, off the hot path

**The pain.** `report()` aggregates in memory, which is perfect for a test and useless for a service:
restart the process and the month's spend is gone. So you write the rows to a database — and now every
model call waits on your disk, because the bus fans out to subscribers **inline**.

**What this shows.** A sink is core's `Sink` protocol and nothing more — `write(entry)`, plus optional
`flush()` / `close()`. Small enough to show whole, so the recipe builds both halves:

- **`JsonlSink`** — the durable half: append one JSON line per spend row.
- **`OffHotPath`** — the decoupling half: enqueue and return; drain in the background, **in order**.

Durability is opt-in at shutdown, and that is deliberate: a background drainer means an abrupt exit
can lose queued rows. `flush()` waits until the queue is empty; `close()` flushes and releases.

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
shutdown         : flush() drained the queue before close() - a background drainer would otherwise leave rows unwritten on an abrupt exit
```

Four calls were attempted and **three** rows persisted. The fourth was blocked pre-flight, so there is
no spend row for it — correct, because no money was spent, and exactly why you also watch the
`BudgetEvent` stream. Alerting on "spend went up" cannot tell you the breaker fired.

The rows are read back from the file, the way a *different* process would. Note `usd` arrives as a
**string** (`"0.0045"`) — the Decimal serialised without going through a float. The recipe asserts
that, and asserts the drainer preserved write order.

Call shapes: `useSink` (camelCase); `event.capTokens` on a `BudgetEvent` (class fields are camelCase,
while the spend rows a sink receives keep the snake_case wire keys — `input_tokens`, `output_tokens`).

## ⚠️ Why this recipe hand-rolls the queue instead of using `QueueSink`

`@cendor/tokenguard/sinks` ships **`QueueSink`**, which is `OffHotPath` done properly: bounded
back-pressure, drop accounting, a real idle handshake. The Python twin uses its equivalent. Two things
stop this recipe from importing it today, both measured on 2026-07-31 in clean containers:

1. **`better-sqlite3@12.11.1` publishes no prebuilt binary for Node 20 on linux-x64.** `npm install`
   falls back to `node-gyp`, and `node:20-slim` has no Python and no compiler:

   ```text
   prebuild-install warn install No prebuilt binaries found (target=20.20.2 runtime=node arch=x64 libc= platform=linux)
   gyp ERR! find Python  Could not find any Python installation to use
   ```

   The same install succeeds on `node:22-slim` in 7 seconds — so anything depending on it is **green
   on Node 22 and red on Node 20**, exactly the failure the node 20 + 22 matrix exists to catch.

2. **On `@cendor/tokenguard` 3.0.2 the whole `sinks` subpath then fails to import** — not just
   `SQLiteSink`. `dist/sinks.js` carried a *value* import of `better-sqlite3` at module scope, and
   `better-sqlite3` is an `optionalDependency`, which npm silently **skips** when it cannot build:

   ```text
   Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'better-sqlite3'
     imported from .../@cendor/tokenguard/dist/sinks.js
   ```

   `npm install` *succeeds*; the failure only appears at the first import. `QueueSink` and `OTelSink`,
   neither of which touches SQLite, were collateral damage.

Point 2 is a real defect and **it was found by this recipe**. It is fixed in `cendor-libs-js`
(`import type` + a `createRequire` load inside `SQLiteSink`'s constructor — the pattern
`@cendor/squeeze`'s `store.ts` already used) and pinned by a regression test with a negative control,
but the fix is **not yet published**. When `@cendor/tokenguard >= 3.0.3` ships, swap `OffHotPath` for
the real thing — the shape is identical:

```js
import { QueueSink } from '@cendor/tokenguard/sinks';
useSink(new QueueSink(new JsonlSink(path)));
```

Python has neither constraint: its `QueueSink` and `SQLiteSink` are stdlib-backed, which is why the
Python twin uses both and this one does not.

Python twin: [`libs/tokenguard-durable-spend`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/libs/tokenguard-durable-spend) ·
Packages: `@cendor/core`, `@cendor/tokenguard` · Offline ✓ · [← all recipes](../../../README.md)
