#!/usr/bin/env node
/**
 * Assert every committed `index.mjs` is exactly what its `index.mts` generates.
 *
 * ⚠️ Why this exists. The cookbook ships each recipe twice — TypeScript source and runnable
 * JavaScript — and two copies of one thing drift. That is not a hypothesis: this workspace has
 * measured it repeatedly (a README promising a `RECORD=1` switch no code implemented; six provider
 * recipes claiming a guardrails gate they never imported). The difference here is that a `.mjs` is
 * executable, so a drifted pair fails in the reader's hands, not ours: they copy the JS, it behaves
 * unlike the TS the docs discuss, and every other gate stays green because both files run fine.
 *
 * Byte-equality is the only check that actually holds. "Both files pass their tests" does not —
 * two implementations can each be correct and still teach different things.
 *
 * Negative control: `node scripts/check-ts-js-sync.mjs --self-test` runs a hand-edited `.mjs`, a
 * missing `.mjs` and a stale one through the comparison in memory and demands each is reported. A
 * check that cannot fail is not a check — and this repo shipped a gate that could not fail once
 * already.
 *
 * Usage:  node scripts/check-ts-js-sync.mjs [--self-test] [recipeDir...]
 * Exit:   0 = every pair is in sync, 1 = at least one is not
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { ROOT, eraseTypes, findSources, generateAll, mjsFor, typecheck } from './build-recipes.mjs';

const rel = (p) => relative(ROOT, p).split(sep).join('/');

/**
 * Compare one generated text against what is committed.
 * Exported shape kept tiny so `--self-test` can drive it with no filesystem.
 */
export function compareOne(slug, committed, generated) {
  if (committed === null) {
    return [`${slug}: no committed .mjs — run \`node scripts/build-recipes.mjs\``];
  }
  if (committed === generated) return [];

  const a = committed.split('\n');
  const b = generated.split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const detail =
    i >= a.length || i >= b.length
      ? `committed has ${a.length} line(s), generated has ${b.length}`
      : `first difference at line ${i + 1}:\n      committed: ${JSON.stringify(a[i])}\n      generated: ${JSON.stringify(b[i])}`;
  return [
    `${slug}: the committed .mjs is NOT what its .mts generates — ` +
      `it was hand-edited, or the .mts changed without a rebuild.\n      ${detail}`,
  ];
}

function selfTest() {
  const cases = [
    {
      what: 'a hand-edited .mjs',
      out: compareOne('x/y', 'const a = 1;\n', 'const a = 2;\n'),
    },
    {
      what: 'a missing .mjs',
      out: compareOne('x/y', null, 'const a = 1;\n'),
    },
    {
      what: 'a stale .mjs (source grew a line)',
      out: compareOne('x/y', 'const a = 1;\n', 'const a = 1;\nconst b = 2;\n'),
    },
  ];
  const clean = [compareOne('x/y', 'const a = 1;\n', 'const a = 1;\n')];

  // The erasure itself must actually erase — a self-test that only exercised string comparison
  // would pass even if ts-blank-space were a no-op, which is the failure it exists to prevent.
  const { js } = eraseTypes('const n: number = 1;\nexport type T = string;\n', 'self-test');
  const erasureWorks = !js.includes(': number') && !js.includes('export type');

  let bad = 0;
  for (const c of cases) {
    if (c.out.length === 0) {
      console.error(`SELF-TEST FAILED: ${c.what} was NOT reported`);
      bad++;
    }
  }
  for (const c of clean) {
    if (c.length !== 0) {
      console.error(`SELF-TEST FAILED: an in-sync pair was reported: ${c[0]}`);
      bad++;
    }
  }
  if (!erasureWorks) {
    console.error('SELF-TEST FAILED: eraseTypes left TypeScript syntax in its output');
    bad++;
  }
  if (bad) process.exit(1);
  console.log(
    `check-ts-js-sync self-test: PASS (${cases.length} drift shapes detected, ` +
      `${clean.length} in-sync pair silent, type-erasure verified)`,
  );
  process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();

const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = findSources(dirs);
if (files.length === 0) {
  console.error('check-ts-js-sync: no .mts sources found — nothing to check');
  process.exit(1);
}

// A drifted pair is usually a stale .mjs, but a .mts that no longer compiles would generate
// nonsense — so the typecheck runs first and its failure is reported as itself.
const diagnostics = typecheck(files);
if (diagnostics) {
  console.error(diagnostics);
  console.error('check-ts-js-sync: typecheck FAILED — fix the .mts before comparing');
  process.exit(1);
}

const problems = [];
const generated = generateAll(files);
for (const [path, text] of generated) {
  const committed = existsSync(path) ? readFileSync(path, 'utf8') : null;
  problems.push(...compareOne(rel(path), committed, text));
}

// The inverse gap: a `.mjs` with NO `.mts` beside it is a recipe file that escaped the
// TypeScript-source rule altogether. The sweep above starts from the sources, so it is structurally
// blind to that file — it would report "every pair in sync" while a hand-written .mjs sat next to
// the generated ones, which is exactly the "a gate that cannot see a file reads as full coverage"
// trap this workspace keeps re-learning.
const expected = new Set(files.map(mjsFor));
const bases = dirs.length ? dirs.map((d) => join(ROOT, d)) : [join(ROOT, 'recipes')];
const walkMjs = (dir, found) => {
  if (!existsSync(dir)) return found;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'fixtures') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkMjs(p, found);
    else if (name.endsWith('.mjs')) found.push(p);
  }
  return found;
};
for (const base of bases) {
  for (const mjs of walkMjs(base, [])) {
    if (expected.has(mjs)) continue;
    problems.push(
      `${rel(mjs)}: a committed .mjs with no .mts beside it — every recipe file is generated ` +
        'from TypeScript source. Write the .mts, then rebuild.',
    );
  }
}

if (problems.length) {
  console.error(`\ncheck-ts-js-sync: ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('\n  Fix: node scripts/build-recipes.mjs\n');
  process.exit(1);
}
console.log(
  `check-ts-js-sync: PASS — ${files.length} .mts/.mjs pair(s), every generated byte matches what is committed`,
);
