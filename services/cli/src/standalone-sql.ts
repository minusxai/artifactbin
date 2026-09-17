/** Standalone-only composition: the SQL engine's lazy import is redirected here by binary.mjs. */
import {getAsset,isSea} from 'node:sea';
import {compileFunction} from 'node:vm';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {configDir,servicePackageUrl} from './config';
import {ensureNativePackage,type NativePackage} from './native-package';
export async function loadDuckDB():Promise<typeof import('@duckdb/node-api')>{
 if(!isSea())return import('@duckdb/node-api');
 const spec=JSON.parse(Buffer.from(getAsset('sql-manifest')).toString()) as NativePackage;
 const root=await ensureNativePackage({...spec,url:servicePackageUrl(spec.url)},{root:join(configDir(),'services','sql')});
 const binding=spec.files.find(file=>file.path.endsWith('/duckdb.node'));
 if(!binding)throw new Error('DuckDB package has no native binding.');
 const require=createRequire(join(root,'loader.cjs'));
 const module={exports:{}};
 compileFunction(Buffer.from(getAsset('sql-driver')).toString(),['require','module','exports'])(
  (name:string)=>name==='@duckdb/node-bindings'?require(join(root,binding.path)):require(name),module,module.exports);
 return module.exports as typeof import('@duckdb/node-api');
}
