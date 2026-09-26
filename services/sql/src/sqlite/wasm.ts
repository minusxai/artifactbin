/**
 * LOADING SQLITE. The official `@sqlite.org/sqlite-wasm` build, the same wasm
 * on the server and in the browser. In Node the package reads its own
 * `sqlite3.wasm`; a browser (or the offline file, which cannot fetch) hands
 * the bytes in. One module per process serves every database: a database is
 * cheap, the module is not (see CONTRACT.md for measured costs).
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

export type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;

// The package types its initializer without the Emscripten module argument it forwards.
const init = sqlite3InitModule as unknown as (module?: { wasmBinary?: ArrayBuffer | Uint8Array; locateFile?: (path: string) => string }) => Promise<Sqlite3>;
let fromPackage: Promise<Sqlite3> | null = null;
/** Bytes a host supplied for the default module (a single-file binary cannot read the package's own file). */
let supplied: ArrayBuffer | Uint8Array | null = null;

/**
 * Supply the wasm the DEFAULT module loads from, before the first load — for a
 * host whose package files are not on disk (the CLI's single executable
 * carries them as an embedded asset).
 */
export function provideSqliteWasm(wasm: ArrayBuffer | Uint8Array): void {
  supplied = wasm;
}

/**
 * A SANDBOXED document (an opaque origin: the served `/raw` page) throws on
 * merely reading `localStorage`/`sessionStorage`, and the library's optional
 * key-value VFS probes both while it initialises — which aborts the whole
 * load. The engine keeps nothing in browser storage, so for the length of the
 * load such a document is shown none, and its own accessors come back after.
 */
async function withoutThrowingStorage<T>(load: () => Promise<T>): Promise<T> {
  const shadowed = (['localStorage', 'sessionStorage'] as const).filter((name) => {
    try { void (globalThis as Record<string, unknown>)[name]; return false; } catch { /* refused: shadow it */ }
    Object.defineProperty(globalThis, name, { value: undefined, configurable: true });
    return true;
  });
  try { return await load(); } finally {
    for (const name of shadowed) delete (globalThis as Record<string, unknown>)[name];
  }
}

async function start(wasmBinary?: ArrayBuffer | Uint8Array): Promise<Sqlite3> {
  // Supplied bytes are never fetched, but the module still names its wasm by
  // resolving against `import.meta.url` — which a classic script (the offline
  // file's inline bundle) does not have, and `new URL(…, undefined)` throws.
  // Naming the file ourselves skips that resolution.
  const sqlite3 = await withoutThrowingStorage(() => init(wasmBinary ? { wasmBinary, locateFile: (path) => path } : undefined));
  // Failures reach the caller as errors; the library's own console warnings would only duplicate them.
  sqlite3.config.warn = () => {};
  return sqlite3;
}

/** The module from the package's own wasm file, loaded once; or from supplied bytes. */
export function loadSqliteModule(wasm?: ArrayBuffer | Uint8Array): Promise<Sqlite3> {
  if (wasm) return start(wasm);
  return (fromPackage ??= start(supplied ?? undefined).catch((error) => { fromPackage = null; throw error; }));
}
