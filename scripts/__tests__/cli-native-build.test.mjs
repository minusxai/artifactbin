import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {standaloneSqlSource} from '../../services/cli/scripts/duckdb-native.mjs';
it('standalone composition redirects the runtime import without rewriting TypeScript type imports',async()=>{
 const source=await readFile(new URL('../../services/sql/src/engine.ts',import.meta.url),'utf8');
 const {code}=await transform(standaloneSqlSource(source),{loader:'ts',format:'cjs'});
 expect(code).toContain('require("afbin:sql-native").loadDuckDB()');
 expect(code).not.toContain('import("@duckdb/node-api")');
});
