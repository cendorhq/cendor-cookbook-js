#!/usr/bin/env node
/**
 * Gate — the counts written in prose in README.md match what is on disk.
 *
 *   node scripts/check-readme-count.mjs
 *
 * ⚠️ **Why, measured 2026-08-03.** The README carries a *table* listing every recipe (checked against
 * both trees by `cendor-site/scripts/check-recipe-cards.mjs`) and, separately, a **sentence stating a
 * total**. Nothing read the sentence, so it drifted: it said *"52 recipes across 11 categories"* while
 * the tree held **53** and the table listed all 53. The table was right; the prose was stale. The
 * Python twin had the identical defect, one number further behind.
 *
 * A number in prose rots silently because no gate reads prose. This reads it.
 *
 * The Python half of this pair (`cendor-cookbook/scripts/check_readme_counts.py`) additionally checks
 * a parity sentence and a notebook count, which only exist over there.
 *
 * ## Honest limit
 *
 * This checks the numbers, not the claims around them. It cannot tell you the sentence is *true* —
 * only that its arithmetic matches the filesystem.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RECIPES = join(ROOT, 'recipes');

const dirs = (p) => readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory());

const categories = dirs(RECIPES).map((c) => c.name);
const recipes = categories.flatMap((c) => dirs(join(RECIPES, c)).map((r) => `${c}/${r.name}`));

// ⚠️ Normalize CRLF before matching. These checkouts are CRLF on Windows, and a pattern anchored on
// a newline silently matches nothing — the exact way the sibling card gate passed vacuously on its
// first run, and the way cendor-mcp once shipped 0 canonical examples instead of 8.
const text = readFileSync(join(ROOT, 'README.md'), 'utf8').replace(/\r\n/g, '\n');

const problems = [];
const m = text.match(/\*\*(\d+)\s+recipes across\s+(\d+)\s+categories\*\*/);
if (m === null) {
  problems.push(
    "the count sentence ('**N recipes across M categories**') is gone — if it was deliberately " +
      'reworded, update this gate in the same commit rather than leaving it matching nothing',
  );
} else {
  const [, statedRecipes, statedCategories] = m;
  if (Number(statedRecipes) !== recipes.length) {
    problems.push(`README says ${statedRecipes} recipes; the tree has ${recipes.length}`);
  }
  if (Number(statedCategories) !== categories.length) {
    problems.push(`README says ${statedCategories} categories; the tree has ${categories.length}`);
  }
}

console.log(
  `check-readme-count: ${problems.length ? 'FAIL' : 'PASS'} — ${recipes.length} recipe(s) across ` +
    `${categories.length} categor(ies), ${problems.length} stale count(s)`,
);
for (const p of problems) console.error(`  ${p}`);
process.exit(problems.length ? 1 : 0);
