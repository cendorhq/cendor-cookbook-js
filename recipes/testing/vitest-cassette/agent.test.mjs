/**
 * The suite. Two tests, both offline, both asserting the thing a mock cannot: that the provider was
 * not reached.
 *
 * Run:  npx vitest run
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as cassette from '@cendor/cassette';
import { beforeEach, describe, expect, it } from 'vitest';

import { answerRefundQuestion, providerCalls } from './agent.mjs';

const QUESTION = 'How long does a duplicate-charge refund take?';

let tape;
beforeEach(() => {
  tape = join(mkdtempSync(join(tmpdir(), 'cendor-vitest-')), 'refund.json');
  providerCalls.n = 0;
});

describe('answerRefundQuestion', () => {
  it('records on the first run and replays on the second, with zero provider calls', async () => {
    const recorded = await cassette.using(tape, { mode: 'record' }, () => answerRefundQuestion(QUESTION));
    const afterRecord = providerCalls.n;

    providerCalls.n = 0;
    const replayed = await cassette.using(tape, { mode: 'replay' }, () => answerRefundQuestion(QUESTION));

    expect(afterRecord).toBe(1); //           the recording pass really called the provider
    expect(providerCalls.n).toBe(0); //       the replay did NOT — this is the $0 claim
    expect(replayed).toBe(recorded); //       and it returned the same answer
  });

  it('asserts on MEANING, so a re-recorded fixture does not break the test', async () => {
    await cassette.using(tape, { mode: 'record' }, () => answerRefundQuestion(QUESTION));
    providerCalls.n = 0;
    const answer = await cassette.using(tape, { mode: 'replay' }, () => answerRefundQuestion(QUESTION));

    // `semanticMatch`, not a string equality. A replayed answer is byte-identical today; when the
    // fixture is re-recorded against a live model, the wording WILL differ, and a `toBe(...)` here
    // would fail for no reason that matters.
    //
    // ⚠️ In TypeScript the DEFAULT scorer is `lexicalScore` (threshold 0.6) — token overlap, not
    // meaning. Python defaults the same way, but Python can also reach for `localEmbeddingScorer`
    // (model2vec), which has no maintained JS port. Measured on this pair: the reword below scores
    // 0.75, while a true paraphrase ("refunds take about five business days") scores 0.51 and would
    // FAIL. For real paraphrase tolerance, pass `openaiEmbeddingScorer(...)` as the 4th argument.
    expect(cassette.semanticMatch(answer, 'a refund is issued within 5 business days')).toBe(true);
    expect(providerCalls.n).toBe(0);
  });
});
