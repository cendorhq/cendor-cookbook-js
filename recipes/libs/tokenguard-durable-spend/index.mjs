/**
 * tokenguard-durable-spend (JS) — spend that survives the process, without paying for it per call.
 *
 * report() aggregates in memory. Perfect for a test, useless for a long-running service: restart the
 * process and the month's spend is gone. A SINK persists each row as it happens — but the bus fans
 * out to subscribers INLINE, so a naive durable sink adds its I/O latency to every single model call.
 *
 * A sink is core's `Sink` protocol and nothing more: `write(entry)`, plus optional `flush()` /
 * `close()`. That is small enough to show whole, so this recipe builds both halves:
 *
 *   JsonlSink    the durable half — append one JSON line per spend row
 *   OffHotPath   the decoupling half — enqueue and return; drain in the background, IN ORDER
 *
 * `@cendor/tokenguard/sinks` ships `QueueSink`, which is the second half done properly (bounded
 * back-pressure, drop accounting, an idle handshake). ⚠️ See the README: on `@cendor/tokenguard`
 * 3.0.2 that subpath cannot be imported at all unless the optional native `better-sqlite3` installed,
 * which it does not on Node 20 / linux-x64 — so this recipe stays on its own 15 lines until the fix
 * ships. Swap `OffHotPath` for `QueueSink` then; the shape is the same.
 *
 * The same bus carries BudgetEvents — the only signal a BLOCKED call leaves, because a call refused
 * pre-flight never becomes an LLMCall and so never reaches a sink at all.
 *
 * Offline: a fake OpenAI-shaped client and a temp file. Run:  npm install && node index.mjs
 */
import { appendFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bus, instrument } from '@cendor/core';
import { BudgetEvent, BudgetExceeded, report, reset, track, useSink, withBudget } from '@cendor/tokenguard';

const MODEL = 'gpt-4o';

/**
 * The durable half. Each spend row arrives as
 * `{ tags, usd, input_tokens, output_tokens, reasoning_tokens, model }` — and `usd` is the Decimal
 * as a STRING, never a float, so appending it to a file loses no precision.
 */
class JsonlSink {
  constructor(path) {
    this.path = path;
    writeFileSync(path, '');
  }
  write(entry) {
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
  }
  close() {} // nothing to release; a socket-backed sink would disconnect here
}

/** The decoupling half: enqueue and return, drain in the background, preserve order. */
class OffHotPath {
  constructor(inner) {
    this.inner = inner;
    this.queue = [];
    this.draining = null;
  }
  write(entry) {
    this.queue.push(entry); // returns immediately — the model call does not wait on I/O
    this.draining ??= Promise.resolve().then(() => {
      while (this.queue.length > 0) this.inner.write(this.queue.shift());
      this.draining = null;
    });
  }
  async flush() {
    while (this.draining) await this.draining; // the durability handshake
  }
  async close() {
    await this.flush();
    this.inner.close?.();
  }
}

function fakeOpenAI() {
  return instrument({
    chat: {
      completions: {
        create: async () => ({
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

const sink = new OffHotPath(new JsonlSink(file));
const previous = useSink(sink);
try {
  for (const tenant of ['acme', 'acme', 'globex']) {
    await track({ tenant }, () =>
      withBudget({ usd: 1.0, onExceed: 'block' }, () =>
        client.chat.completions.create({ model: MODEL, messages: [{ role: 'user', content: 'hi' }] }),
      ),
    );
  }
  // A fourth call under a cap it cannot fit: refused pre-flight, so it never becomes an LLMCall and
  // never reaches the sink. The BudgetEvent is the only trace it leaves.
  try {
    await track({ tenant: 'globex' }, () =>
      withBudget({ tokens: 10, onExceed: 'block' }, () =>
        client.chat.completions.create({ model: MODEL, messages: [{ role: 'user', content: 'hi' }] }),
      ),
    );
  } catch (err) {
    if (!(err instanceof BudgetExceeded)) throw err;
  }
  await sink.flush();
} finally {
  useSink(previous);
  await sink.close();
  bus.unsubscribe(watch);
}

// Read the rows back the way a DIFFERENT process would: straight out of the file.
const rows = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const inMemory = Object.fromEntries(report(['tenant']).rows.map((r) => [r.tags.tenant, r]));
const last = blocked.at(-1);

console.log(`persisted rows   : ${rows.length} in spend.jsonl (${statSync(file).size} bytes)`);
for (const r of rows) {
  console.log(`  ${JSON.stringify(r.tags).padEnd(20)} $${r.usd}  ${r.input_tokens} in / ${r.output_tokens} out`);
}
console.log(`in-memory report : acme $${inMemory.acme.usd.amount.toString()} over ${inMemory.acme.calls} calls, globex $${inMemory.globex.usd.amount.toString()}`);
console.log(`budget events    : ${blocked.length} - action='${last.action}', cap=${last.capTokens} tokens (a blocked call emits no LLMCall, so this is the ONLY signal)`);
console.log('shutdown         : flush() drained the queue before close() - a background drainer would otherwise leave rows unwritten on an abrupt exit');

if (rows.length !== 3) throw new Error('one persisted row per call that actually happened');
if (blocked.length !== 1 || last.action !== 'blocked') throw new Error('the block was not on the bus');
if (!rows.every((r) => 'tenant' in r.tags)) throw new Error('track() tags did not reach the sink');
if (rows.some((r) => typeof r.usd !== 'string')) throw new Error('usd must reach a sink as a Decimal string');
if (rows[2].tags.tenant !== 'globex') throw new Error('the drainer did not preserve write order');
