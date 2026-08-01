#!/usr/bin/env node
/**
 * Generate every recipe's runnable `index.mjs` from its TypeScript source `index.mts`.
 *
 * The cookbook is TypeScript-source, JavaScript-runnable. `.mts` is what a contributor writes and
 * what CI typechecks; the committed `.mjs` beside it is what `node index.mjs` runs, so a reader who
 * does not use TypeScript still gets a file they can copy without a toolchain, a build step, or a
 * loader. Both are first-class reading material — which is why the `.mjs` is FORMATTED rather than
 * merely emitted.
 *
 * ## Why not `tsc`
 *
 * Measured before this script existed. `tsc` re-prints from the AST: it drops every blank line,
 * re-indents to 4 spaces, and splits `if (cond) return;` across two lines. Correct JavaScript, but
 * it reads like build output — and in a copy-paste cookbook the JS file is the product, not an
 * artifact. ts-blank-space instead overwrites type syntax with spaces, so structure, comments and
 * blank lines survive byte-for-byte; its cost is whitespace holes (`const seen            = [];`),
 * which biome then closes. tsc still does the TYPECHECKING here — it is only the emitter we replace.
 *
 * ## The contract
 *
 * `.mjs` is GENERATED. Never hand-edit one: `check-ts-js-sync.mjs` regenerates every file and fails
 * on a single differing byte, so an edit made there is reverted by the next build and rejected by CI
 * in between. Edit the `.mts`.
 *
 * Determinism is why `scripts/package.json` pins typescript / ts-blank-space / biome EXACTLY. A
 * caret range would let two machines generate two different files from one source and call each
 * other wrong.
 *
 * Usage:  node scripts/build-recipes.mjs [recipeDir...]     (default: every recipe)
 * Exit:   0 = generated, 1 = a typecheck error or unsupported syntax
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import tsBlankSpace from 'ts-blank-space';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');
const RECIPES = join(ROOT, 'recipes');
const require = createRequire(import.meta.url);

/** Every `*.mts` under the given recipe directories (default: the whole tree). */
export function findSources(dirs) {
  const roots = dirs?.length ? dirs.map((d) => resolve(ROOT, d)) : [RECIPES];
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      // node_modules holds .mts files belonging to dependencies — never ours.
      if (name === 'node_modules' || name === 'fixtures') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.mts')) out.push(p);
    }
  };
  for (const r of roots) walk(r);
  return out.sort();
}

/** The `.mjs` a given `.mts` generates. tsc uses this same mapping natively. */
export const mjsFor = (mts) => mts.replace(/\.mts$/, '.mjs');

/**
 * Typecheck with the compiler API, reading the repo tsconfig so there is ONE definition of strict.
 * Returns formatted diagnostic text ('' when clean).
 */
export function typecheck(files) {
  const configPath = join(ROOT, 'tsconfig.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) {
    return ts.formatDiagnosticsWithColorAndContext([read.error], diagHost());
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT);
  const program = ts.createProgram(files, { ...parsed.options, noEmit: true });
  const diags = ts.getPreEmitDiagnostics(program);
  return diags.length ? ts.formatDiagnosticsWithColorAndContext(diags, diagHost()) : '';
}

function diagHost() {
  return {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => ROOT,
    getNewLine: () => '\n',
  };
}

/**
 * Erase types from one source string. Exported so the sync gate and `--self-test` can call it
 * without touching the filesystem.
 *
 * ts-blank-space cannot erase syntax that carries runtime meaning (`enum`, `namespace`, parameter
 * properties, decorators). Those are reported rather than silently mangled — a recipe using one
 * must be rewritten, because there is no honest way to hand a reader JS for it.
 */
export function eraseTypes(source, label) {
  const problems = [];
  const js = tsBlankSpace(source, (node) => {
    const { line } = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
    problems.push(`${label}:${line + 1}: unsupported syntax for type-erasure (${ts.SyntaxKind[node.kind]})`);
  });
  return { js, problems };
}

/** Run biome's formatter over a directory tree, using the repo's biome.json. */
function formatDir(dir) {
  const shim = require.resolve('@biomejs/biome/bin/biome');
  const res = spawnSync(process.execPath, [shim, 'format', '--write', '--config-path', ROOT, dir], {
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`biome format failed:\n${res.stdout || ''}${res.stderr || ''}`);
  }
}

/**
 * Generate the JS for every source into a scratch tree, formatted — WITHOUT writing into the repo.
 * Both `build` and `check` go through here, so the gate can never disagree with the generator by
 * construction. Returns Map<mjsPath, generatedText>.
 */
export function generateAll(files) {
  const scratch = join(ROOT, '.recipe-build');
  rmSync(scratch, { recursive: true, force: true });

  const allProblems = [];
  const staged = new Map(); // scratchPath -> final .mjs path
  for (const mts of files) {
    const label = relative(ROOT, mts).split(sep).join('/');
    const { js, problems } = eraseTypes(readFileSync(mts, 'utf8'), label);
    allProblems.push(...problems);
    // Mirror the repo-relative path so identically-named files (several recipes ship an agent.mts)
    // cannot collide in the scratch tree.
    const scratchPath = join(scratch, relative(ROOT, mjsFor(mts)));
    mkdirSync(dirname(scratchPath), { recursive: true });
    writeFileSync(scratchPath, js, 'utf8');
    staged.set(scratchPath, mjsFor(mts));
  }
  if (allProblems.length) {
    rmSync(scratch, { recursive: true, force: true });
    const err = new Error(`type-erasure failed:\n  ${allProblems.join('\n  ')}`);
    err.problems = allProblems;
    throw err;
  }

  formatDir(scratch);

  const out = new Map();
  for (const [scratchPath, finalPath] of staged) {
    out.set(finalPath, readFileSync(scratchPath, 'utf8'));
  }
  rmSync(scratch, { recursive: true, force: true });
  return out;
}

function main() {
  const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const files = findSources(dirs);
  if (files.length === 0) {
    console.error('build-recipes: no .mts sources found — nothing to generate');
    process.exit(1);
  }

  const diagnostics = typecheck(files);
  if (diagnostics) {
    console.error(diagnostics);
    console.error(`build-recipes: typecheck FAILED — no .mjs was written`);
    process.exit(1);
  }

  const generated = generateAll(files);
  let changed = 0;
  for (const [path, text] of generated) {
    const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (before !== text) {
      writeFileSync(path, text, 'utf8');
      changed++;
      console.log(`  updated  ${relative(ROOT, path).split(sep).join('/')}`);
    }
  }
  console.log(
    `build-recipes: ${files.length} source(s) typechecked, ${changed} .mjs written, ` +
      `${files.length - changed} already current`,
  );
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
