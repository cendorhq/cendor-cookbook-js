/**
 * The "application" under test — an agent that calls a model. Nothing test-specific lives here, and
 * that is the point: the suite records and replays THIS code, unmodified.
 */
import { instrument } from '@cendor/core';

/** Counts calls that actually reached the client. Exported so the test can assert on $0. */
export const providerCalls = { n: 0 };

function client() {
  return instrument({
    chat: {
      completions: {
        create: async (_req: { model: string; messages: { role: string; content: string }[] }) => {
          providerCalls.n++;
          return {
            choices: [{ message: { content: 'A duplicate charge is refunded within 5 business days.' } }],
            usage: { prompt_tokens: 42, completion_tokens: 14 },
            model: 'gpt-4o',
          };
        },
      },
    },
  });
}

export async function answerRefundQuestion(question: string) {
  const resp = await client().chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: question }],
  });
  return resp.choices[0].message.content;
}
