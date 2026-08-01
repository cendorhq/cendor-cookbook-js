/**
 * squeeze-persist-and-restore (JS) — restore the original after the process is gone.
 *
 * squeeze is reversible because it keeps the original in a CONTENT-ADDRESSED store, keyed by the hash
 * of the content. The default store is in-process, which is right for a request handler and wrong for
 * anything that outlives a request: restart, and every handle you persisted expands into a KeyError.
 *
 * useStore(backend) swaps it. A backend is ANY object with `get(key) -> string` and
 * `put(key, value) -> void` — @cendor/squeeze ships `MemoryStore` (the default) and `SQLiteStore`, and
 * this recipe writes a nine-line file-backed one so it needs no native module (see the README:
 * SQLiteStore is backed by the optional `better-sqlite3`, which has no prebuilt binary for Node 20 on
 * linux-x64).
 *
 * Then a handle is portable: handle.toDict() is JSON, Handle.fromDict(...) rebuilds it, and expand()
 * resolves through whatever store is active NOW.
 *
 * Proven across a REAL process boundary — this file re-executes itself with `--restore`, in a second
 * node process that shares nothing but two files on disk. The child also tries the same handle against
 * a fresh in-memory store and reports the failure, so the difference is measured, not described.
 *
 * Offline: pure compression, no model call. Run:  npm install && node index.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokens } from '@cendor/core';
import { Handle, KeyError, MemoryStore, compress, decompress, useStore } from '@cendor/squeeze';

const MODEL = 'gpt-4o';
const HERE = fileURLToPath(import.meta.url);

/** A durable CCR backend in nine lines — the whole `StoreBackend` contract. */
class FileStore {
  path;
  data;

  constructor(path) {
    this.path = path;
    this.data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  }
  get(key) {
    if (!(key in this.data)) throw new KeyError(key);
    return this.data[key];
  }
  put(key, value) {
    this.data[key] = value;
    writeFileSync(this.path, JSON.stringify(this.data));
  }
}

function incidentReport(lines = 500) {
  return Array.from({ length: lines }, (_, i) => {
    const mm = String(i % 60).padStart(2, '0');
    return `2026-07-31T11:${mm}:${mm}Z WARN api-7 retry ${i} upstream=payments code=503 backoff_ms=${100 * (i % 5)}`;
  }).join('\n');
}

const digest = (text) => createHash('sha256').update(text).digest('hex');

/** The SECOND process. It has the files and nothing else — no objects, no store in memory. */
function restore(workdir) {
  const saved = JSON.parse(readFileSync(join(workdir, 'handle.json'), 'utf8'));
  const handle = Handle.fromDict(saved.handle);

  // (a) the default in-process store knows nothing about a previous process.
  useStore(new MemoryStore());
  let memoryResult;
  try {
    decompress(handle);
    memoryResult = 'expanded (unexpected)';
  } catch (err) {
    // A `catch` binding is `unknown` under strict TypeScript — narrow before reading `.name`.
    const name = err instanceof Error ? err.name : String(err);
    memoryResult = `${name} - the in-process store died with the first process`;
  }

  // (b) the durable store has the original on disk.
  useStore(new FileStore(join(workdir, 'originals.json')));
  const restored = decompress(handle);

  console.log(`  process 2 pid    : ${process.pid} (a different interpreter)`);
  console.log(`  MemoryStore()    : ${memoryResult}`);
  console.log(
    `  FileStore(...)   : restored ${restored.length.toLocaleString('en-US')} chars, sha256 matches: ${digest(restored) === saved.digest}`,
  );
  assert.equal(digest(restored), saved.digest, 'the restored content is not the original');
}

const restoreArg = process.argv.indexOf('--restore');
if (restoreArg !== -1) {
  restore(process.argv[restoreArg + 1]);
} else {
  const workdir = mkdtempSync(join(tmpdir(), 'cendor-recipe-'));
  const store = join(workdir, 'originals.json');
  const content = incidentReport();

  useStore(new FileStore(store)); // durable backend, BEFORE anything is compressed
  const [small, handle] = compress(content, { kind: 'logs', model: MODEL });
  writeFileSync(
    join(workdir, 'handle.json'),
    JSON.stringify({ handle: handle.toDict(), digest: digest(content) }),
  );

  console.log(`  process 1 pid    : ${process.pid}`);
  console.log(
    `  compressed       : ${tokens.count(content, MODEL).toLocaleString('en-US')} -> ${tokens.count(small, MODEL)} tokens (${handle.technique})`,
  );
  console.log(
    `  store on disk    : originals.json, ${statSync(store).size.toLocaleString('en-US')} bytes`,
  );
  console.log(
    `  handle.toDict()  : ${JSON.stringify(handle.toDict()).length} bytes of JSON - this is what you persist, not the original`,
  );
  console.log('-- process ends here; everything in memory is lost ------------------');

  const child = spawnSync(process.execPath, [HERE, '--restore', workdir], { encoding: 'utf8' });
  process.stdout.write(child.stdout);
  if (child.status !== 0) {
    process.stderr.write(child.stderr);
    throw new Error('the second process could not restore');
  }
  if (!child.stdout.includes('sha256 matches: true'))
    throw new Error('the second process could not restore');
}
