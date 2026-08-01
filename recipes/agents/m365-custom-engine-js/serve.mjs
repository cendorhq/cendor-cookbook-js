/**
 * Start the governed agent on :3979 so the M365 Agents Playground can drive it.
 *
 *   cd recipes/agents/m365-custom-engine-js && npm install && node serve.mjs
 *
 * Then, in another terminal:
 *
 *   agentsplayground -e "http://localhost:3979/api/messages" -c emulator
 *
 * ⚠️ This file exists because the one-liner the README used to carry was the recipe's most likely
 * failure. `node -e "import('./agent.mjs')…"` resolves `./agent.mjs` relative to the CURRENT
 * DIRECTORY, so running it from the repo root gives
 * `ERR_MODULE_NOT_FOUND … cendor-cookbook-js/agent.mjs` — measured, verbatim — which reads as "the
 * recipe doesn't run" and has nothing to do with the agent. It also needs `npm install` to have
 * happened in this folder first (per-recipe installs, no workspace).
 *
 * So: this script imports by URL relative to itself, and turns a busy port into one readable line
 * instead of an `EADDRINUSE` stack. Nothing here is a cendor surface.
 */
import net from 'node:net';
import process from 'node:process';

import { GovernedAgent, serve } from './agent.mjs';

const PORT = Number(process.env.PORT ?? 3979);
const AUDIT = process.env.AUDIT_PATH ?? 'chain.jsonl';

const free = await new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.once('listening', () => s.close(() => resolve(true)));
  s.listen(PORT, '127.0.0.1');
});

if (!free) {
  console.error(
    `Port ${PORT} is already in use — something else is listening there.\n` +
      `Stop it, or start this agent somewhere else:  PORT=3989 node serve.mjs`,
  );
  process.exit(2);
}

console.log(`audit chain : ${AUDIT}`);
console.log(`endpoint    : http://localhost:${PORT}/api/messages   (anonymous — LOCAL ONLY)`);
console.log(
  `drive it    : agentsplayground -e "http://localhost:${PORT}/api/messages" -c emulator`,
);
console.log('(verified against @microsoft/m365agentsplayground 0.2.28)\n');

await serve(new GovernedAgent({ auditPath: AUDIT }), PORT);
