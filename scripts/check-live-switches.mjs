#!/usr/bin/env node
/**
 * Assert every recipe README's **"Live switch:"** claim matches what `index.mjs` actually implements.
 *
 * ⚠️ Why this exists. On 2026-08-01 five brand-new recipes shipped a footer reading
 * `Live switch: RECORD=1` while their `index.mjs` contained no `process.env.RECORD` at all. Nothing
 * failed: the recipe ran offline exactly as documented, CI was green, and the only thing wrong was a
 * promise no code kept. That is the same class of defect the 2026-08-01 cookbook sweep was called in
 * to find — six of seven provider recipes claiming a guardrails gate they never imported — and it is
 * invisible to every other gate in this repo, because a README is not executable.
 *
 * The rule, both ways:
 *   • a README that names a switch  ⇒ `index.mjs` must read that env var
 *   • a README that says "none"     ⇒ `index.mjs` must read no live-switch env var
 *
 * The second direction matters as much as the first: a recipe that quietly grew a live path without
 * saying so is a recipe that can reach the network on someone's laptop unannounced.
 *
 * Negative control: `node scripts/check-live-switches.mjs --self-test` runs both failure shapes
 * through the checker in memory and demands each is reported. A check that cannot fail is not a
 * check.
 *
 * Usage:  node scripts/check-live-switches.mjs [--self-test]
 * Exit:   0 = every claim matches, 1 = at least one does not
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RECIPES = join(ROOT, 'recipes');

/** Env vars that mean "this recipe can talk to a real provider". */
const SWITCH_VARS = ['RECORD', 'LIVE', 'OLLAMA_LIVE', 'USE_FOUNDRY_SDK'];

/** The `Live switch: …` value from a README footer, or null when the footer has no such field. */
export function claimedSwitch(readme) {
  const m = readme.match(/Live switch:\s*([^·\n]*)/);
  return m ? m[1].trim() : null;
}

/** Env vars the source actually reads. */
export function implementedSwitches(source) {
  return SWITCH_VARS.filter((v) => new RegExp(`process\\.env\\.${v}\\b`).test(source));
}

/**
 * Compare one recipe's claim against its source.
 * Exported so `--self-test` can drive it without touching the filesystem.
 */
export function checkOne(slug, readme, source) {
  const claim = claimedSwitch(readme);
  if (claim === null) return [`${slug}: README footer has no "Live switch:" field`];
  const impl = implementedSwitches(source);
  const claimsNone = /^none\b/i.test(claim);

  if (claimsNone && impl.length > 0) {
    return [
      `${slug}: README says "Live switch: ${claim}" but index.mjs reads ${impl.join(', ')} — ` +
        'the recipe has an undocumented path to a real provider',
    ];
  }
  if (!claimsNone) {
    if (impl.length === 0) {
      return [
        `${slug}: README promises "Live switch: ${claim}" but index.mjs reads none of ` +
          `${SWITCH_VARS.join('/')} — the switch does not exist`,
      ];
    }
    const named = impl.filter((v) => claim.includes(v));
    if (named.length === 0) {
      return [
        `${slug}: README promises "Live switch: ${claim}" but index.mjs reads ${impl.join(', ')} — ` +
          'the documented variable is not the one the code checks',
      ];
    }
  }
  return [];
}

function selfTest() {
  const cases = [
    {
      what: 'a promised switch that does not exist',
      out: checkOne('x/y', 'Live switch: `RECORD=1` ·', 'console.log("offline only");'),
    },
    {
      what: 'an undocumented live path',
      out: checkOne('x/y', 'Live switch: none (offline only) ·', 'if (process.env.RECORD) go();'),
    },
    {
      what: 'a switch documented under the wrong variable',
      out: checkOne('x/y', 'Live switch: `RECORD=1` ·', 'if (process.env.OLLAMA_LIVE) go();'),
    },
  ];
  const clean = [
    checkOne('x/y', 'Live switch: none (offline only) ·', 'console.log("offline");'),
    checkOne('x/y', 'Live switch: `RECORD=1` ·', 'if (process.env.RECORD === "1") go();'),
  ];
  let bad = 0;
  for (const c of cases) {
    if (c.out.length === 0) {
      console.error(`SELF-TEST FAILED: ${c.what} was NOT reported`);
      bad++;
    }
  }
  for (const c of clean) {
    if (c.length !== 0) {
      console.error(`SELF-TEST FAILED: a correct recipe was reported: ${c[0]}`);
      bad++;
    }
  }
  if (bad) process.exit(1);
  console.log(
    'check-live-switches self-test: PASS ' +
      `(${cases.length} broken shapes detected, ${clean.length} correct shapes silent)`,
  );
  process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();

const problems = [];
let checked = 0;
for (const cat of readdirSync(RECIPES)) {
  if (!statSync(join(RECIPES, cat)).isDirectory()) continue;
  for (const rec of readdirSync(join(RECIPES, cat))) {
    const dir = join(RECIPES, cat, rec);
    if (!statSync(dir).isDirectory()) continue;
    const readme = join(dir, 'README.md');
    const source = join(dir, 'index.mjs');
    if (!existsSync(readme) || !existsSync(source)) continue;
    checked++;
    problems.push(
      ...checkOne(`${cat}/${rec}`, readFileSync(readme, 'utf8'), readFileSync(source, 'utf8')),
    );
  }
}

if (problems.length) {
  console.error(`\ncheck-live-switches: ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`check-live-switches: PASS — ${checked} recipe(s), every claim matches the code`);
