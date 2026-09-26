/**
 * THE SQLITE WASM IN A SINGLE EXECUTABLE. The engine package reads its
 * `sqlite3.wasm` from beside its own module, which a single executable does
 * not have on disk; the binary carries the file as an asset instead
 * (scripts/binary.mjs), supplied here before the first query. From npm or
 * source the package's own file is read and this does nothing.
 */
import {isSea,getAsset} from 'node:sea';
import {provideSqliteWasm} from '@artifactbin/sql/core';
if(isSea())provideSqliteWasm(new Uint8Array(getAsset('sqlite-wasm')));
