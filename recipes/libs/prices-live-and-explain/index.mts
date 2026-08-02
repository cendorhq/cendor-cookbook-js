/**
 * prices-live-and-explain (JS) — where a rate came from, and what to do when it is old.
 *
 * Every USD number cendor prints starts as a per-token rate looked up in a price table. Which table,
 * from which source, as of which date, and does one of YOUR registrations override it? Until you can
 * answer that, a cost figure is a number with no provenance — and a USD cap enforced against a rate
 * nobody can source is a control you cannot defend in a review.
 *
 *   prices.explain(model)   the whole answer for one id: resolved key, how it resolved, the rates,
 *                           which SOURCE that specific row came from, that source's own as-of date,
 *                           whether a registration of yours is in effect, and honest caveats.
 *                           Never throws: an unpriced model is an answer, not an error.
 *   prices.refresh()        pull a newer table. Never-throw by default (a CDN blip must not take
 *                           your app down at import); `{ required: true }` when that is wrong.
 *   prices.save() / load()  the ONLY persistence. refresh() is in-memory, per process, and writes no
 *                           hidden cache — because a hidden cache is exactly how prices go invisibly
 *                           stale. You choose the path; provenance rides along.
 *   StalePriceTableWarning  tokenguard says so, once per process, when a USD budget estimates from a
 *                           table older than 45 days.
 *
 * ⚠️ TWO REAL DIVERGENCES FROM THE PYTHON TWIN, both structural rather than cosmetic:
 *   1. `refresh`, `save` and `load` are ASYNC here (`await`); Python's are synchronous.
 *   2. JavaScript has no `warnings` module, so the stale warning is an ERROR OBJECT delivered to
 *      `onStalePricesWarning(listener)` — and with no listener installed it goes to `console.warn`.
 *      Python filters by class; here you subscribe. A listener may re-throw to escalate.
 *
 * Offline: everything below runs on the BUNDLED snapshot, which carries per-row provenance because
 * it is generated from the cendor-prices feed rather than typed by hand. No key, no network.
 *
 * Run:  npm install && node index.mjs
 *       LIVE=1 node index.mjs      # also fetch the real feed
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { instrument, prices } from '@cendor/core';
import { StalePriceTableWarning, onStalePricesWarning, reset, withBudget } from '@cendor/tokenguard';

const MODEL = 'gpt-4o';
/** A Bedrock wire id. Nothing registers it; the table answers through NORMALIZATION. */
const WIRE_ID = 'eu.anthropic.claude-sonnet-4-6-v1:0';
/** A Microsoft Foundry deployment name. Arbitrary by construction, so no table on earth has it. */
const DEPLOYMENT = 'prod-chat-eastus';

/** tokenguard's default staleness threshold is 45 days; this table is deliberately older. */
const STALE_UPDATED = '2026-01-01';

/** An OpenAI-shaped client. `instrument()` identifies a client by shape, not by name. */
function fakeClient() {
  return instrument({
    chat: {
      completions: {
        create: async (params: { model: string; messages: unknown[] }) => ({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1200, completion_tokens: 300 },
          model: params.model ?? MODEL,
        }),
      },
    },
  });
}

function show(label: string, model: string) {
  const e = prices.explain(model);
  console.log(`  ${label.padEnd(11)}: ${e.summary()}`);
  console.log(`  ${''.padEnd(11)}  how=${JSON.stringify(e.how)} registered=${e.registered} rowSource=${JSON.stringify(e.rowSource)}`);
  for (const note of e.notes) console.log(`  ${''.padEnd(11)}  note: ${note}`);
}

const tmp = mkdtempSync(join(tmpdir(), 'cendor-prices-'));
const good = join(tmp, 'prices.json');

// ── 1. explain(): the same question, three different answers ─────────────────────────────────────
//
// `how` is the part to read. 'exact' = the id IS a table key. 'normalized' = a wire-level id was
// reduced to its base, which is why a Bedrock ARN-shaped id prices at all. 'unpriced' = no rate
// exists — and that is an ANSWER, not an exception, because the honest output of a missing price is
// null plus a warn-once, never a guess.
console.log('--- explain(): where did this rate come from? --------------------');
console.log(`  ${'table'.padEnd(11)}: ${prices.sourceName()} (${prices.source()}), ${prices.models().length} rows, snapshotDate=${prices.snapshotDate()}, age=${prices.ageDays()}d`);
show('exact', MODEL);
show('normalized', WIRE_ID);
show('unpriced', DEPLOYMENT);

// ── 2. the precedence contract ───────────────────────────────────────────────────────────────────
//
// A registration outranks EVERY table and survives every refresh()/load(). That is the answer to
// "the live price is wrong for me" — negotiated rates, a private deployment, a fine-tune. And
// `registerDeployment` is the form that needs no rate card: you name the model your deployment
// serves, which you already know.
console.log('\n--- a registration outranks every table --------------------------');
const rates = prices.registerDeployment(DEPLOYMENT, { like: MODEL });
console.log(`  ${'register'.padEnd(11)}: registerDeployment(${JSON.stringify(DEPLOYMENT)}, { like: ${JSON.stringify(MODEL)} }) -> input=${rates.input} output=${rates.output}`);
show('deployment', DEPLOYMENT);

// ── 3. save() / load(): the only persistence, and it is yours ────────────────────────────────────
//
// refresh() is in-memory ONLY, per process — a serverless worker starts at the bundled snapshot
// every time. There is deliberately no implicit cache. save()/load() is the explicit escape hatch,
// and provenance rides along: after a load(), explain() still describes where the rates CAME FROM,
// not where they were read from.
console.log('\n--- save() / load(): explicit, never implicit ---------------------');
await prices.save(good);
const written = JSON.parse(readFileSync(good, 'utf8')) as {
  models: Record<string, unknown>;
  _schema: string;
  _provenance?: unknown;
};
console.log(`  ${'saved'.padEnd(11)}: prices.json (${Object.keys(written.models).length} rows, _schema=${JSON.stringify(written._schema)}, keeps _provenance=${'_provenance' in written})`);
const loaded = await prices.load(good);
console.log(`  ${'loaded'.padEnd(11)}: ${loaded} -> source()=${JSON.stringify(prices.source())} sourceName()=${JSON.stringify(prices.sourceName())} snapshotDate=${prices.snapshotDate()}`);
show('after load', MODEL);
console.log(`  ${''.padEnd(11)}  the registration was re-applied too: explain(${JSON.stringify(DEPLOYMENT)}).registered = ${prices.explain(DEPLOYMENT).registered}`);

// ── 4. refresh() is never-throw — until you ask for the loud one ─────────────────────────────────
//
// Both calls below go nowhere: 127.0.0.1:9 is the discard port, so this is a local socket that
// fails, not a network fetch. The DEFAULT keeps the last-good table and resolves false, because a
// CDN blip must never take an application down at import. In a billing job or a CI cost gate that
// trade is wrong, and `{ required: true }` throws instead.
console.log('\n--- refresh(): silent by default, loud on request -----------------');
const dead = 'http://127.0.0.1:9/nope.json';
const quiet = await prices.refresh(dead, { timeout: 1000 });
console.log(`  ${'default'.padEnd(11)}: refresh(<unreachable>) -> ${quiet}  (table untouched: ${prices.models().length} rows still loaded)`);
let thrown = 'nothing';
try {
  await prices.refresh(dead, { timeout: 1000, required: true });
} catch (err) {
  thrown = (err as Error).name;
}
console.log(`  ${'required'.padEnd(11)}: refresh(<unreachable>, { required: true }) -> throws ${thrown}`);

// ── 5. an OLD table is a wrong cap, in a direction that depends on the price move ────────────────
//
// After a price CUT a stale table over-estimates and the cap binds early (conservative). After a
// price RISE it under-estimates and the cap binds LATE — you overspend. tokenguard warns once per
// process when a USD budget prices a call from a table older than 45 days.
console.log('\n--- a stale table binds the cap late ------------------------------');
const staleFile = join(tmp, 'stale.json');
const aged = JSON.parse(readFileSync(good, 'utf8')) as Record<string, unknown>;
aged._updated = STALE_UPDATED;
writeFileSync(staleFile, JSON.stringify(aged, null, 1), 'utf8');
await prices.load(staleFile);
console.log(`  ${'table'.padEnd(11)}: snapshotDate=${prices.snapshotDate()} age=${prices.ageDays()}d isStale(45)=${prices.isStale(45)}`);

// ⚠️ The listener IS the filter here. Installed, the warning stops going to console.warn and comes
// to you as an object — which is what lets a build escalate it (`throw warning`) instead of
// scraping stderr for a string.
const caught: StalePriceTableWarning[] = [];
const off = onStalePricesWarning((w) => caught.push(w));
const client = fakeClient();
await withBudget({ usd: '5.00', onExceed: 'block' }, async () => {
  await client.chat.completions.create({ model: MODEL, messages: [{ role: 'user', content: 'a' }] });
  await client.chat.completions.create({ model: MODEL, messages: [{ role: 'user', content: 'b' }] });
});
off();
console.log(`  ${'two calls'.padEnd(11)}: ${caught.length} StalePriceTableWarning for 2 priced calls (once per process, not per call — a hot loop must not become a log flood)`);
console.log(`  ${'silence it'.padEnd(11)}: configure({ onStalePrices: 'ignore' }), or move the threshold with stalePricesAfterDays`);

// ── 6. undatable is not fresh ────────────────────────────────────────────────────────────────────
//
// litellm, openrouter and vercel publish no as-of date. isStale() reports false for those, and
// false there means UNKNOWN, not fresh. Inventing an age would be the exact dishonesty the whole
// provenance design exists to avoid — so explain() says so in a note instead.
console.log('\n--- undatable is not the same as fresh ----------------------------');
const undated = join(tmp, 'undated.json');
delete aged._updated;
writeFileSync(undated, JSON.stringify(aged, null, 1), 'utf8');
await prices.load(undated);
console.log(`  ${'table'.padEnd(11)}: snapshotDate=${prices.snapshotDate()} ageDays()=${prices.ageDays()} isStale(45)=${prices.isStale(45)}`);
show('undated', MODEL);

// ── 7. LIVE=1 — the real feed, and a gateway's resale rate ───────────────────────────────────────
//
// A bare refresh() fetches the cendor-prices feed: a static, keyless JSON file on GitHub's CDN,
// reconciled daily from Microsoft's and Amazon's own catalogs plus the MIT aggregators, with
// per-row provenance. Cendor operates no service here, so there is no Cendor outage that can break
// your cost estimation.
const live = process.env.LIVE === '1';
console.log(`\n--- the live feed (${live ? 'LIVE=1' : 'skipped — set LIVE=1'}) -----------------`);
if (live) {
  const ok = await prices.refresh();
  console.log(`  ${'feed'.padEnd(11)}: refresh() -> ${ok}, ${prices.models().length} rows, snapshotDate=${prices.snapshotDate()}, source=${JSON.stringify(prices.sourceName())}`);
  show('gpt-4o', MODEL);
  // A gateway sells you someone else's model at its own price. explain() surfaces that rather than
  // burying it in the docs, because a resale rate silently substituted for a lab's rate is a cost
  // report that is wrong and confident.
  if (await prices.refresh(undefined, { source: 'openrouter' })) {
    console.log(`  ${'resale'.padEnd(11)}: refresh({ source: 'openrouter' }) -> ${prices.models().length} rows`);
    show('gpt-4o', MODEL);
  }
} else {
  console.log(`  ${'offline'.padEnd(11)}: every section above ran on the bundled snapshot, which is GENERATED`);
  console.log(`  ${''.padEnd(11)}  from that same feed — which is why rowSource/rowAsof exist here`);
}

// ── assertions: the recipe is its own test ───────────────────────────────────────────────────────
await prices.load(good);
reset();
assert.equal(prices.explain(MODEL).how, 'exact', 'a table key should resolve exactly');
assert.equal(prices.explain(WIRE_ID).how, 'normalized', 'a wire id should reduce to its base');
assert.ok(prices.explain(DEPLOYMENT).registered, 'a registration must survive save()/load()');
assert.equal(prices.explain('no-such-model-ever').how, 'unpriced', 'explain() must never throw');
assert.equal(quiet, false, 'an unreachable refresh() must resolve false, not throw');
assert.equal(thrown, 'PriceRefreshError', '{ required: true } must throw PriceRefreshError');
assert.equal(caught.length, 1, 'StalePriceTableWarning is once per process, not per call');
