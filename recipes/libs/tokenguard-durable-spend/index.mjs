/**
 * tokenguard-durable-spend (JS) — spend that survives the process, without paying for it per call.
 *
 * report() aggregates in memory. Perfect for a test, useless for a long-running service: restart the
 * process and the month's spend is gone. A SINK persists each row as it happens — but the bus fans
 * out to subscribers INLINE, so a naive durable sink adds its I/O latency to every single model call.
 *
 * `QueueSink` decouples that: `write()` enqueues and returns immediately, while one background worker
 * drains the queue into the inner sink IN ORDER, with bounded back-pressure and drop accounting.
 *
 *     useSink(new QueueSink(mySink))
 *
 * The inner sink is core's `Sink` protocol and nothing more — `write(entry)`, plus optional `flush()`
 * / `close()` — small enough to show whole, so this recipe writes its own JSONL one rather than using
 * the bundled `SQLiteSink` (see the README: that one needs the optional native `better-sqlite3`, which
 * has no prebuilt binary for Node 20 on linux-x64, and a copy-paste recipe should not need a C++
 * toolchain).
 *
 * The same bus carries BudgetEvents — the only signal a BLOCKED call leaves, because a call refused
 * pre-flight never becomes an LLMCall and so never reaches a sink at all.
 *
 * Offline: a fake OpenAI-shaped client and a temp file. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bus, instrument } from '@cendor/core';
import {
  BudgetEvent,
  BudgetExceeded,
  report,
  reset,
  track,
  useSink,
  withBudget,
} from '@cendor/tokenguard';
import { QueueSink } from '@cendor/tokenguard/sinks';

const MODEL = 'gpt-4o';

/**
 * The durable inner sink. Each spend row arrives as
 * `{ tags, usd, input_tokens, output_tokens, reasoning_tokens, model }` — and `usd` is the Decimal
 * as a STRING, never a float, so appending it to a file loses no precision.
 */
class JsonlSink {
  path;

  constructor(path) {
    this.path = path;
    writeFileSync(path, '');
  }
  write(entry) {
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
  }
  close() {} // nothing to release; a socket-backed sink would disconnect here
}

function fakeOpenAI() {
  return instrument({
    chat: {
      completions: {
        create: async (_req) => ({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1000, completion_tokens: 200 },
          model: MODEL,
        }),
      },
    },
  });
}

reset();
const file = join(mkdtempSync(join(tmpdir(), 'cendor-recipe-')), 'spend.jsonl');
const client = fakeOpenAI();

const blocked = [];
const watch = (event) => {
  if (event instanceof BudgetEvent) blocked.push(event);
};
bus.subscribe(watch);

const sink = new QueueSink(new JsonlSink(file));
const previous = useSink(sink);
try {
  for (const tenant of ['acme', 'acme', 'globex']) {
    await track({ tenant }, () =>
      withBudget({ usd: 1.0, onExceed: 'block' }, () =>
        client.chat.completions.create({
          model: MODEL,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ),
    );
  }
  // A fourth call under a cap it cannot fit: refused pre-flight, so it never becomes an LLMCall and
  // never reaches the sink. The BudgetEvent is the only trace it leaves.
  try {
    await track({ tenant: 'globex' }, () =>
      withBudget({ tokens: 10, onExceed: 'block' }, () =>
        client.chat.completions.create({
          model: MODEL,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ),
    );
  } catch (err) {
    if (!(err instanceof BudgetExceeded)) throw err;
  }
  await sink.flush(); // block until the worker has drained — the durability handshake
} finally {
  useSink(previous);
  await sink.close();
  bus.unsubscribe(watch);
}

// Read the rows back the way a DIFFERENT process would: straight out of the file.
const rows = readFileSync(file, 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));
const inMemory = Object.fromEntries(report(['tenant']).rows.map((r) => [r.tags.tenant, r]));
const last = blocked.at(-1);

console.log(`persisted rows   : ${rows.length} in spend.jsonl (${statSync(file).size} bytes)`);
for (const r of rows) {
  console.log(
    `  ${JSON.stringify(r.tags).padEnd(20)} $${r.usd}  ${r.input_tokens} in / ${r.output_tokens} out`,
  );
}
console.log(
  `in-memory report : acme $${inMemory.acme.usd.amount.toString()} over ${inMemory.acme.calls} calls, globex $${inMemory.globex.usd.amount.toString()}`,
);
assert.ok(last, 'no BudgetEvent reached the bus — a blocked call leaves no other trace');
console.log(
  `budget events    : ${blocked.length} - action='${last.action}', cap=${last.capTokens} tokens (a blocked call emits no LLMCall, so this is the ONLY signal)`,
);
console.log(
  'shutdown         : flush() drained the queue before close() - a background worker would otherwise leave rows unwritten on an abrupt exit',
);

assert.equal(rows.length, 3, 'one persisted row per call that actually happened');
if (blocked.length !== 1 || last.action !== 'blocked')
  throw new Error('the block was not on the bus');
if (!rows.every((r) => 'tenant' in r.tags)) throw new Error('track() tags did not reach the sink');
assert.ok(
  rows.every((r) => typeof r.usd === 'string'),
  'usd must reach a sink as a Decimal string',
);
assert.equal(rows[2].tags.tenant, 'globex', 'QueueSink did not preserve write order');
