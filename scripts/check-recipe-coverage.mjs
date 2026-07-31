#!/usr/bin/env node
/**
 * Assert that CI actually runs every recipe.
 *
 * Each CI shard LOOPS over its category directory, so a new *recipe* is covered automatically. The
 * hole is a new *category*: `recipes/<new>/…` would simply never be visited, and nothing would say
 * so — the README's "every recipe runs offline" claim would quietly stop being backed by anything.
 * The Python cookbook shipped exactly that hole once (four bridge recipes CI had never executed).
 *
 * So: every directory under `recipes/` must appear in the `category:` matrix in
 * `.github/workflows/ci.yml`, and every category in the matrix must exist on disk (a matrix row
 * pointing at a deleted category fails the shard's own empty check, but is worth naming here too).
 *
 * Also checks the shape a shard depends on: each recipe directory has a `package.json` and an
 * `index.mjs`.
 *
 * Negative control: `node scripts/check-recipe-coverage.mjs --self-test` fabricates an uncovered
 * category in memory and asserts this script reports it. A check that cannot fail is not a check.
 *
 * Usage:  node scripts/check-recipe-coverage.mjs [--self-test]
 * Exit:   0 = covered, 1 = a gap
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'ci.yml');
const RECIPES = join(ROOT, 'recipes');

/** The `category: [a, b, c]` list from the CI matrix. Deliberately a narrow regex over one known
 *  line rather than a YAML parser — no dependency, and it fails loudly if the line ever moves. */
export function parseCategories(yaml) {
  const m = yaml.match(/^\s*category:\s*\[([^\]]*)\]\s*$/m);
  if (!m) return null;
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

/** Category directories that exist on disk. */
function diskCategories(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => statSync(join(dir, n)).isDirectory())
    .sort();
}

function recipeDirs(dir, category) {
  const base = join(dir, category);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((n) => statSync(join(base, n)).isDirectory())
    .sort();
}

function check({ categories, onDisk, recipesOf }) {
  const problems = [];
  const covered = new Set(categories);
  for (const c of onDisk) {
    if (!covered.has(c)) {
      problems.push(
        `recipes/${c}/ is NOT in the CI matrix — add "${c}" to the \`category:\` list in .github/workflows/ci.yml`,
      );
    }
  }
  for (const c of categories) {
    if (!onDisk.includes(c)) {
      problems.push(`the CI matrix lists category "${c}" but recipes/${c}/ does not exist`);
    }
  }
  return problems;
}

function selfTest() {
  // Negative control: a category on disk that the matrix does not list MUST be reported.
  const problems = check({
    categories: ['quickstarts'],
    onDisk: ['quickstarts', 'ghost-category'],
    recipesOf: () => [],
  });
  const caught = problems.some((p) => p.includes('ghost-category'));
  // ...and the clean case must report nothing.
  const clean = check({ categories: ['a', 'b'], onDisk: ['a', 'b'], recipesOf: () => [] });
  if (!caught) {
    console.error('SELF-TEST FAILED: an uncovered category was not reported');
    process.exit(1);
  }
  if (clean.length !== 0) {
    console.error(`SELF-TEST FAILED: a covered tree reported ${clean.length} problem(s)`);
    process.exit(1);
  }
  console.log('check-recipe-coverage self-test: PASS (uncovered category detected, clean tree silent)');
  process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();

if (!existsSync(WORKFLOW)) {
  console.error(`check-recipe-coverage: ${WORKFLOW} not found`);
  process.exit(1);
}

const categories = parseCategories(readFileSync(WORKFLOW, 'utf8'));
if (categories === null) {
  console.error(
    'check-recipe-coverage: could not find a `category: [...]` line in .github/workflows/ci.yml.\n' +
      '  The matrix shape changed — update this script rather than deleting it.',
  );
  process.exit(1);
}

const onDisk = diskCategories(RECIPES);
const problems = check({ categories, onDisk, recipesOf: (c) => recipeDirs(RECIPES, c) });

// Shape: every recipe directory must carry the two files a shard runs.
let recipeCount = 0;
for (const c of onDisk) {
  for (const r of recipeDirs(RECIPES, c)) {
    recipeCount++;
    for (const f of ['package.json', 'index.mjs']) {
      if (!existsSync(join(RECIPES, c, r, f))) {
        problems.push(`recipes/${c}/${r}/ has no ${f}`);
      }
    }
  }
}

if (problems.length) {
  console.error(`\ncheck-recipe-coverage: ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log(
  `check-recipe-coverage: PASS — ${recipeCount} recipe(s) across ${onDisk.length} categor(ies), ` +
    `all reachable from the CI matrix [${categories.join(', ')}]`,
);
