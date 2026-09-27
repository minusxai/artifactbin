/**
 * THE SQLITE WASM IN A BUILT CLI. The engine package reads its `sqlite3.wasm` from beside its own
 * module, which neither the single executable nor a bundle copied on its own has on disk; every build
 * embeds the bytes (src/sqlite-wasm-embedded.ts), supplied here before the first query. From source
 * nothing is embedded and the package's own file is read.
 */
import {provideSqliteWasm} from '@artifactbin/sql/core';
import {embeddedSqliteWasm} from './sqlite-wasm-embedded';
if(embeddedSqliteWasm)provideSqliteWasm(embeddedSqliteWasm);
