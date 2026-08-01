/**
 * record-a-governed-run (JS) — record the whole governed triad once, re-run it forever for $0.
 *
 * The usual objection to governance in CI is cost: if every test run makes real calls to prove your
 * budget works, you pay to prove it. @cendor/cassette removes the bill without removing the
 * governance. Record a run that is budgeted (tokenguard) and audited (acttrace); on replay the
 * provider is NEVER reached, yet the same budget accrues the recorded usage and the same audit chain
 * is written and verifies.
 *
 * The proof is a client that throws if it is ever called. If the replay reached the provider, this
 * recipe crashes instead of printing.
 *
 * Offline both ways. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, verify } from '@cendor/acttrace';
import * as cassette from '@cendor/cassette';
import { instrument } from '@cendor/core';
import { report, reset, track, withBudget } from '@cendor/tokenguard';

const MODEL = 'gpt-4o';
const PROMPT = [{ role: 'user', content: 'summarize the release notes' }];

/** A fake OpenAI-shaped client. `boom` makes any real call an immediate failure — which is how the
 * $0 claim is PROVEN rather than asserted. */
function provider({ boom = false } = {}) {
  const state = { calls: 0 };
  state.completions = {
    create: async () => {
      state.calls++;
      if (boom) throw new Error('a replayed run must never reach the provider');
      return {
        choices: [{ message: { content: 'three fixes, one feature' } }],
        usage: { prompt_tokens: 820, completion_tokens: 140 },
        model: MODEL,
      };
    },
  };
  state.client = instrument({ chat: { completions: state.completions } });
  return state;
}

reset();
const dir = mkdtempSync(join(tmpdir(), 'cendor-recipe-'));
const tape = join(dir, 'release-notes.json');
const chain = join(dir, 'replay-audit.jsonl');

// ---- pass 1: record a governed run (the only pass that would cost money) ------------------------
const live = provider();
await track({ feature: 'release-notes' }, () =>
  withBudget({ usd: 0.5, onExceed: 'block' }, () =>
    cassette.using(tape, { mode: 'record' }, () =>
      live.client.chat.completions.create({ model: MODEL, messages: PROMPT }),
    ),
  ),
);

// ---- pass 2: replay it. Same governance, same audit, no provider. -------------------------------
const audit = new AuditLog('release-notes', { riskTier: 'limited', path: chain });
const boom = provider({ boom: true });
let replayed;
try {
  replayed = await track({ feature: 'release-notes-replay' }, () =>
    withBudget({ usd: 0.5, onExceed: 'block' }, () =>
      cassette.using(tape, { mode: 'replay' }, () =>
        boom.client.chat.completions.create({ model: MODEL, messages: PROMPT }),
      ),
    ),
  );
} finally {
  audit.detach();
}

const rows = Object.fromEntries(report(['feature']).rows.map((r) => [r.tags.feature, r]));
const recordedRow = rows['release-notes'];
const replayRow = rows['release-notes-replay'];
const audited = audit.entries.filter((e) => e.type === 'llm_call');
const [ok, detail] = verify(chain);
const line = (label, calls, row) =>
  `${label}: provider called ${calls}x · ${row.tokens} tok · $${row.usd.amount.toString()}`;

console.log(line('record  ', live.calls, recordedRow));
console.log(line('replay  ', boom.calls, replayRow));
console.log('          ^ the same tokens are accounted, with $0 of REAL spend');
console.log(`answer  : ${JSON.stringify(replayed.choices[0].message.content)}`);
console.log(`audited : ${audited.length} llm_call entry chained on the replay`);
console.log(`verify(): ${ok} — ${detail}`);
console.log(`cassette: ${statSync(tape).size} bytes on disk — commit it and CI runs free`);

if (live.calls !== 1 || boom.calls !== 0) throw new Error('the replay must short-circuit the provider');
assert.equal(replayRow.tokens, recordedRow.tokens, 'the replay did not accrue the recorded usage');
assert.notEqual(audited.length, 0, 'the replayed call was not chained by the attached audit log');
assert.equal(ok, true, 'the replay audit chain failed verify()');
