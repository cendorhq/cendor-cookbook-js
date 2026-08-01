/**
 * @cendor/cassette quickstart (JS) — record an agent call once, replay it forever (offline, free).
 *
 * Every test run that hits a real model costs money and flakes. cassette records the exchange the
 * first time, then replays it: same assertion, zero calls, no network.
 *
 * Offline both ways. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as cassette from '@cendor/cassette';
import { instrument } from '@cendor/core';

// Counts calls that reached the client. A replay recipe that only compared OUTPUT would pass just as
// happily if the "replay" quietly re-called the provider — the call count IS the claim.
const calls = { n: 0 };

function makeClient() {
  return instrument({
    chat: {
      completions: {
        create: async () => {
          calls.n++;
          return {
            choices: [{ message: { content: 'Refund issued.' } }],
            usage: { prompt_tokens: 19, completion_tokens: 4 },
          };
        },
      },
    },
  });
}

async function runAgent() {
  const client = makeClient();
  const resp = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'I was double charged' }],
  });
  return resp.choices[0].message.content;
}

/**
 * Record on the first call, replay on the second — `mode: 'auto'` decides by whether the file is
 * there. That is what makes a cassette usable in CI without a flag: the first developer run writes
 * it, every run afterwards (including the ones with no key) reads it.
 */
async function recordThenReplay(path) {
  calls.n = 0;
  let t0 = performance.now();
  const out1 = await cassette.use(path, { mode: 'auto' })(runAgent)(); // no file yet -> records
  const rec = { out: out1, n: calls.n, ms: performance.now() - t0 };

  calls.n = 0;
  t0 = performance.now();
  const out2 = await cassette.use(path, { mode: 'auto' })(runAgent)(); // file exists -> replays
  const rep = { out: out2, n: calls.n, ms: performance.now() - t0 };
  return { record: rec, replay: rep };
}

const dir = mkdtempSync(join(tmpdir(), 'cendor-recipe-'));
const { record: rec, replay: rep } = await recordThenReplay(join(dir, 'run.json'));

console.log(`run 1: recorded (${rec.n} call, ${rec.ms.toFixed(1)} ms)`);
console.log(`run 2: replayed (${rep.n} calls, offline, ${rep.ms.toFixed(1)} ms)`);
console.log(`same assertion green: ${rec.out === rep.out} == ${JSON.stringify(rec.out)}`);

assert.equal(rec.n, 1, 'the first run should have made exactly one real call');
assert.equal(rep.n, 0, 'the replay reached the client — it is not offline');
assert.equal(rep.out, rec.out, 'the replayed answer differs from the recorded one');
// `semanticMatch` rather than `===`: a replayed reply is byte-identical, but the same assertion
// written this way keeps working when the fixture is later re-recorded against a live model, whose
// wording will differ. (And it will — see libs/cassette-semantic-drift.)
assert.ok(cassette.semanticMatch(rep.out, 'a refund was issued'), 'the replayed answer drifted');
