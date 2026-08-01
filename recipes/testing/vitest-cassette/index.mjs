/**
 * vitest-cassette (JS) — a test suite that never calls a provider.
 *
 * The real artifact of this recipe is `agent.test.mjs`, a **vitest** suite that records a model
 * exchange once and replays it forever: same code path, same assertions, zero provider calls, no
 * key, no network. This file is the CI entry point — it runs that suite and asserts it passed, so
 * the recipe is covered by the same shard loop as every other recipe in the repo.
 *
 * Run the suite directly:  npm test        (or: npx vitest run)
 * Run this wrapper:        npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ⚠️ Vitest's PROGRAMMATIC API, not a spawned CLI. Two dead ends were tried first and both are worth
// naming, because each one fails in a way that looks like something else:
//   • `spawnSync('npx', […], { shell: true })` works, but node 24 deprecates it (DEP0190 — arguments
//     through a shell are concatenated, not escaped), so every run prints a security warning.
//   • resolving the bin path fails twice over: `vitest/vitest.mjs` is the `bin` entry but is NOT in
//     the package's `exports` map (`ERR_PACKAGE_PATH_NOT_EXPORTED`), and `vitest/node` resolves into
//     `dist/`, one level below where `vitest.mjs` actually lives.
// `startVitest` needs no path guessing and no shell, and it works the same on Windows and Linux.
import { startVitest } from 'vitest/node';

const here = dirname(fileURLToPath(import.meta.url));

console.log('running the vitest suite (offline, no key)…\n');
// ⚠️ Collect the GENERATED `.mjs` explicitly. Every recipe file here exists twice — `agent.test.mts`
// is the typed source, `agent.test.mjs` is generated from it — and vitest's default glob matches
// BOTH, so the suite silently runs twice (measured: 2 files / 4 tests for one 2-test suite).
// The `.mjs` is the one that executes, exactly as `node index.mjs` does everywhere else.
const vitest = await startVitest('test', ['agent.test.mjs'], { root: here, watch: false });
await vitest?.close();

const files = vitest?.state.getFiles() ?? [];
// A vitest `Task` is a union of file / suite / test, and only the first two carry `tasks`.
const tests = files.flatMap((f) => f.tasks ?? []).flatMap((s) => s.tasks ?? s);
const failed = files.filter((f) => f.result?.state === 'fail');

console.log(`\ntest files : ${files.length}`);
console.log(`tests      : ${tests.length}`);
console.log(`failed     : ${failed.length}`);

// ⚠️ Assert that tests actually RAN, not just that none failed. A suite that discovered zero files
// has zero failures, and `failed.length === 0` on its own would call that a pass — which is the
// single most common way a test wrapper lies to you.
assert.ok(files.length > 0, 'vitest discovered no test files at all');
assert.ok(tests.length >= 2, `expected at least 2 tests, ran ${tests.length}`);
assert.equal(failed.length, 0, `${failed.length} test file(s) failed`);

console.log('\nOK — the suite passed with zero provider calls.');
