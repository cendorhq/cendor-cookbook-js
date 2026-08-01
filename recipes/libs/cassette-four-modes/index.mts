/**
 * cassette-four-modes (JS) — record, replay, rerecord, auto: four modes, four environments.
 *
 * The modes are one keyword apart and mean very different things. Pick by WHERE the code is running:
 *
 *   record     run live, write the tape. What you do once, deliberately, with a key.
 *   replay     never touch the provider; an unrecorded call THROWS. What CI runs — strict on purpose,
 *              so drift surfaces as a red test instead of a silent live call.
 *   auto       replay if the tape exists, else record. Good for a laptop; WRONG for CI, because a
 *              missing file silently becomes a live call (and a missing key becomes a crash).
 *   rerecord   run live and report drift() — what changed since the tape — WITHOUT overwriting it.
 *
 * And the fifth choice: no cassette scope at all. Nothing is intercepted; every call is live. That is
 * the default, and it is the right answer in production.
 *
 * Offline: a fake OpenAI-shaped client and a temp directory. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cassette from '@cendor/cassette';
import { CassetteError } from '@cendor/cassette';
import { instrument } from '@cendor/core';

const MODEL = 'gpt-4o';
const ASK = [{ role: 'user', content: 'what is the refund window?' }];
const OTHER = [{ role: 'user', content: 'who approved order 8812?' }];

/** A fake provider whose answer changes, and which counts how often it is really reached. */
function provider(answer: string) {
  // One expression, because an object that grows properties after `{ calls: 0 }` has already been
  // inferred as having none of them.
  const state = {
    calls: 0,
    client: instrument({
      chat: {
        completions: {
          create: async (_req: { model: string; messages: { role: string; content: string }[] }) => {
            state.calls++;
            return {
              choices: [{ message: { content: answer } }],
              usage: { prompt_tokens: 24, completion_tokens: 9 },
              model: MODEL,
            };
          },
        },
      },
    }),
  };
  return state;
}

const tape = join(mkdtempSync(join(tmpdir(), 'cendor-recipe-')), 'policy.json');

// ---- record ---------------------------------------------------------------------------------
const p1 = provider('30 days from delivery.');
await cassette.using(tape, { mode: 'record' }, () =>
  p1.client.chat.completions.create({ model: MODEL, messages: ASK }),
);
console.log(`record   : provider ${p1.calls}x -> tape written (${statSync(tape).size} bytes)`);

// ---- replay: free, and STRICT ------------------------------------------------------------------
const p2 = provider('never reached');
const out = await cassette.using(tape, { mode: 'replay' }, () =>
  p2.client.chat.completions.create({ model: MODEL, messages: ASK }),
);
console.log(`replay   : provider ${p2.calls}x -> ${JSON.stringify(out.choices[0].message.content)}`);

const p3 = provider('never reached');
let unrecorded: string | null = null;
try {
  await cassette.using(tape, { mode: 'replay' }, () =>
    p3.client.chat.completions.create({ model: MODEL, messages: OTHER }),
  );
} catch (err) {
  if (!(err instanceof CassetteError)) throw err;
  unrecorded = String(err.message).split('\n')[0];
}
assert.ok(unrecorded, 'replay mode accepted a call that was never recorded');
console.log(`           an UNRECORDED call throws: ${unrecorded.slice(0, 78)}`);

// ---- auto: replays here, but would have recorded if the file were missing -----------------------
const p4 = provider('never reached');
await cassette.using(tape, { mode: 'auto' }, () =>
  p4.client.chat.completions.create({ model: MODEL, messages: ASK }),
);
const missing = join(tape, '..', 'not-there.json');
const p5 = provider('recorded on first use');
await cassette.using(missing, { mode: 'auto' }, () =>
  p5.client.chat.completions.create({ model: MODEL, messages: ASK }),
);
console.log(`auto     : existing tape -> provider ${p4.calls}x (replayed); missing tape -> provider ${p5.calls}x (recorded)`);

// ---- rerecord: run live, report what changed, leave the tape alone ------------------------------
const before = readFileSync(tape);
const p6 = provider('14 days from delivery.'); // the policy changed upstream
await cassette.using(tape, { mode: 'rerecord' }, () =>
  p6.client.chat.completions.create({ model: MODEL, messages: ASK }),
);
const changes = cassette.drift();
console.log(`rerecord : provider ${p6.calls}x -> drift() reports ${changes.length} divergence(s); tape unchanged on disk: ${readFileSync(tape).equals(before)}`);

// ---- no scope at all ----------------------------------------------------------------------------
const p7 = provider('live');
await p7.client.chat.completions.create({ model: MODEL, messages: ASK });
console.log(`no scope : provider ${p7.calls}x - nothing is intercepted; this is production`);

if (p1.calls !== 1 || p2.calls !== 0 || p4.calls !== 0) throw new Error('replay must not reach the provider');
assert.notEqual(unrecorded, null, 'replay must THROW on an unrecorded call, not fall through');
assert.equal(p5.calls, 1, 'auto should have recorded against a missing tape');
if (p6.calls !== 1 || changes.length === 0) throw new Error('rerecord must run live and report the divergence');
assert.ok(readFileSync(tape).equals(before), 'rerecord overwrote the tape');
