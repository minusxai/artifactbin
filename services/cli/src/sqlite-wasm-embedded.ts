/**
 * The SQLite engine's wasm bytes, in a BUILT CLI: every build replaces this module with the file's
 * contents (scripts/bundle-options.mjs `embedSqliteWasm`). From source it stays empty, and the
 * installed package reads its own `sqlite3.wasm`.
 */
export const embeddedSqliteWasm: Uint8Array | null = null;
