/**
 * Scripted Playground smoke — start the agent, drive it the way the Playground does, assert a
 * governed reply came back. No key, no tenant, no clicking.
 *
 *   cd recipes/agents/m365-custom-engine-js && npm install && node smoke.mjs
 *
 * Why this exists: "does it run in the M365 Agents Playground?" was, until 2026-08-01, a question
 * only a human with a browser could answer, so a broken run instruction sat in the README
 * unnoticed. This script answers the same question mechanically. It sends the two Activities the
 * Playground itself sends — a `conversationUpdate` handshake, then a `message` — to the agent's
 * **real** express endpoint, and reads the reply off a local channel stub standing in for the
 * Playground's `/_connector`.
 *
 * ⚠️ What it cannot prove: that the Playground's *own* UI renders the reply. That needs the real
 * Playground binary and a browser, and it was verified by hand on 2026-08-01 against
 * `@microsoft/m365agentsplayground` **0.2.28** — this twin answered `Your refund is on its way.`
 * over the Playground's WebSocket relay.
 *
 * ⚠️ Also measured: the Playground **projects `channelData` away** in that relay. The Cendor
 * envelope is on the wire to the connector — asserted below — but it is not in the chat pane.
 * Assert it in a test; do not go hunting for it in the UI.
 *
 * ⚠️ And the one that only bites on this side: `@microsoft/agents-hosting` persists `TurnState`
 * only inside `if (this._afterTurn.length > 0)`, so without the `app.onTurn('afterTurn', …)` hook
 * this agent registers, a cumulative session ledger never accumulates and the cap silently never
 * binds — while every per-turn number stays correct. `index.mjs` carries the negative control.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { GovernedAgent, buildWebApp } from './agent.mjs';
import { ChannelStub, freePort, makeActivity, postTurn } from './channelStub.mjs';

const CONVERSATION = 'playground-smoke';
const dir = mkdtempSync(join(tmpdir(), 'cendor-m365-smoke-'));

/**
 * The `conversationUpdate` the Playground sends before your first message. The agent registers no
 * handler for it, so the SDK accepts it and routes nowhere — correct, and the first thing a reader
 * tailing the log will see. It is not an error.
 */
const handshake = (serviceUrl) => ({
  type: 'conversationUpdate',
  id: randomUUID(),
  timestamp: new Date(0).toISOString(),
  serviceUrl,
  channelId: 'emulator',
  from: { id: 'user-1', name: 'Cookbook User', role: 'user' },
  conversation: { id: CONVERSATION, conversationType: 'personal', isGroup: false },
  recipient: { id: 'm365-custom-engine', name: 'Governed agent', role: 'bot' },
  membersAdded: [{ id: 'user-1' }, { id: 'm365-custom-engine' }],
});

const agent = new GovernedAgent({ auditPath: join(dir, 'chain.jsonl') });
const stub = await new ChannelStub(await freePort()).start();
const port = await freePort();
const server = await new Promise((resolve) => {
  const s = buildWebApp(agent).listen(port, '127.0.0.1', () => resolve(s));
});
const endpoint = `http://127.0.0.1:${port}/api/messages`;
console.log(`agent      : ${endpoint}`);
console.log(`channel    : ${stub.serviceUrl}  (stands in for the Playground's /_connector)`);

try {
  // 1 — the handshake. Accepted, with no reply activity, is the correct outcome.
  //     202 rather than 200: the Bot Framework protocol ACCEPTS an Activity and answers
  //     out-of-band on the connector, so the reply is never in this response body.
  let status = await postTurn(endpoint, handshake(stub.serviceUrl));
  console.log(`handshake  : conversationUpdate -> HTTP ${status} (no route registered: correct)`);
  assert.ok([200, 202].includes(status), `the handshake was rejected with HTTP ${status}`);

  // 2 — a real message, exactly as the Playground relays one.
  status = await postTurn(
    endpoint,
    makeActivity('I was double charged, can I get a refund?', {
      conversationId: CONVERSATION,
      serviceUrl: stub.serviceUrl,
    }),
  );
  console.log(
    `message    : message -> HTTP ${status} (accepted; the reply arrives on the channel)`,
  );
  assert.ok([200, 202].includes(status), `the message Activity was rejected with HTTP ${status}`);

  const msgs = await stub.waitFor(CONVERSATION, { count: 1, timeout: 30_000 });
  assert.ok(msgs.length, 'the agent never replied — nothing reached the channel');
  const reply = msgs.at(-1);
  assert.ok(reply, 'the agent never replied — nothing reached the channel');
  const text = (reply.text ?? '').trim();
  console.log(`reply      : ${JSON.stringify(text.slice(0, 90))}`);
  assert.ok(text, 'the agent replied with an empty message');

  const env = reply?.channelData?.cendor ?? {};
  console.log(`envelope   : ${JSON.stringify(Object.keys(env).sort())}`);
  for (const field of ['trace_id', 'cost_usd', 'input_tokens', 'output_tokens', 'governance']) {
    assert.ok(field in env, `channelData.cendor is missing ${field}: ${JSON.stringify(env)}`);
  }
  assert.ok(Number(env.cost_usd) > 0, `the turn was priced at ${env.cost_usd}`);
  assert.equal(env.governance, 'ok', `governance said ${env.governance}`);
  console.log(
    `cost       : $${env.cost_usd}  ${env.input_tokens} in / ${env.output_tokens} out  model=${env.model}`,
  );
  console.log(`session    : $${env.session_spent_usd} of $${env.session_cap_usd}`);
} finally {
  await new Promise((r) => server.close(() => r()));
  await stub.stop();
  agent.close();
}

console.log('\nPLAYGROUND SMOKE OK — the agent answers a Playground-shaped turn, governed.');
