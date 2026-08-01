/**
 * block-before-record (JS) — a call that never happened leaves nothing to replay.
 *
 * Ordering is the whole subject. @cendor/guardrails blocks PRE-FLIGHT, before the request leaves
 * your process; @cendor/cassette records on the RESPONSE. So a blocked call is refused before the
 * recorder ever sees anything — and that is the behaviour you want. If a block were recorded, your
 * cassette would grow entries for requests that were never sent, and a later replay would happily
 * "replay" a call the guardrail exists to prevent.
 *
 * Measured here: with a keywordDeny guardrail installed, a forbidden prompt inside a
 * cassette.using(..., { mode: 'record' }) scope reaches the provider ZERO times and writes ZERO
 * cassette entries, while a clean prompt in the same scope records normally.
 *
 * Offline, keyless. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cassette from '@cendor/cassette';
import { instrument } from '@cendor/core';
import { GuardrailTripped, install, rules, uninstall } from '@cendor/guardrails';

const MODEL = 'gpt-4o';

/** A fake OpenAI-shaped client that counts every request that actually reaches it. */
function countingClient(calls) {
  return instrument({
    chat: {
      completions: {
        create: async (_req) => {
          calls.n++;
          return {
            choices: [{ message: { content: 'here is the summary' } }],
            usage: { prompt_tokens: 30, completion_tokens: 8 },
            model: MODEL,
          };
        },
      },
    },
  });
}

function entriesIn(tape) {
  if (!existsSync(tape)) return 0;
  return JSON.parse(readFileSync(tape, 'utf8')).entries.length;
}

const tape = join(mkdtempSync(join(tmpdir(), 'cendor-recipe-')), 'support.json');
const calls = { n: 0 };
const client = countingClient(calls);

install([rules.keywordDeny(['wire transfer'], { action: 'block' })]);
// The trip is RETURNED from the recorded scope rather than assigned into an outer `let`. Both work
// at runtime, but only this shape survives strict TypeScript: a `let` written exclusively inside a
// callback still reads as its initial `null` afterwards, so narrowing it collapses to `never`.
let tripped;
try {
  tripped = await cassette.using(tape, { mode: 'record' }, async () => {
    // 1 — the clean request: allowed, sent, recorded.
    await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: 'summarize ticket 41' }],
    });

    // 2 — the forbidden one: refused before the provider, so never recorded.
    try {
      await client.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'user', content: 'arrange a wire transfer now' }],
      });
    } catch (err) {
      if (!(err instanceof GuardrailTripped)) throw err;
      return err;
    }
    return null;
  });
} finally {
  uninstall();
}

const recorded = entriesIn(tape);
assert.ok(tripped, 'the guardrail did not block the forbidden request');

console.log('clean request    : reached the provider, recorded');
console.log(`blocked request  : GuardrailTripped - ${tripped.message}`);
console.log(`provider calls   : ${calls.n} (the blocked one never left the process)`);
console.log(`cassette entries : ${recorded} - one per call that actually happened`);
console.log('nothing to replay: a request that was refused has no recorded response to hand back');

assert.equal(calls.n, 1, 'the blocked request reached the provider');
assert.equal(recorded, 1, 'a blocked call was written to the cassette');
