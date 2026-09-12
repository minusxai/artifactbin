/** Standalone-only composition: the SQL engine's lazy import is redirected here by binary.mjs. */
import {getAsset} from 'node:sea';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {configDir,servicePackageUrl} from './config';
import {ensureNativePackage,type NativePackage} from './native-package';
export async function loadDuckDB():Promise<typeof import('@duckdb/node-api')>{
 const spec=JSON.parse(Buffer.from(getAsset('sql-manifest')).toString()) as NativePackage;
 const root=await ensureNativePackage({...spec,url:servicePackageUrl(spec.url)},{root:join(configDir(),'services','sql')});
 return createRequire(join(root,'loader.cjs'))('@duckdb/node-api');
}
