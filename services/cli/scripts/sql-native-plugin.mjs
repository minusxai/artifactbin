import {readFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export function standaloneSqlSource(source){
 const needle="duckdbModule ??= import('@duckdb/node-api')";
 if(!source.includes(needle))throw new Error('SQL lazy import changed; review standalone composition.');
 return source.replace(needle,"duckdbModule ??= require('afbin:sql-native').loadDuckDB()");
}
/** Both CLI and embedded host redirect the one existing lazy engine import. */
export function standaloneSqlPlugin(){return {name:'lazy-duckdb',setup(b){
 b.onLoad({filter:/sql\/src\/engine\.ts$/},async({path})=>({contents:standaloneSqlSource(await readFile(path,'utf8')),loader:'ts',resolveDir:dirname(path)}));
 b.onResolve({filter:/^afbin:sql-native$/},()=>({path:fileURLToPath(new URL('../src/standalone-sql.ts',import.meta.url))}));
}};}
