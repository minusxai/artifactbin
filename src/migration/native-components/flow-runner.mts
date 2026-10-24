/** Isolated retained schema compilation only; no credentials, network or destination writes. */
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {retainedCompilerFingerprint} from './analyze.ts';
import {nativeDigest} from './selection.ts';
import {compileNativeFlow,retainedNativeFlowHost} from './flow-producer.ts';
import {cachedNativeCatalogResolver} from './operation-host.ts';
import type {NativeSerializedFlowInput} from './operation-producer-contracts.ts';
const root=path.resolve(process.argv[2]!);let text='';
for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>16*1024*1024)throw Error('native_flow_input_limit');}
const input=JSON.parse(text) as NativeSerializedFlowInput;
const epoch=Date.parse(input.probeClockIso);if(!Number.isFinite(epoch)||new Date(epoch).toISOString()!==input.probeClockIso)throw Error('native_probe_clock_invalid');
const RealDate=Date;
// Only the isolated child uses the captured probe clock. Runtime query clocks remain authoritative.
globalThis.Date=class extends RealDate {constructor(...args:any[]){super(...(args.length?args:[epoch]) as [any]);}static now(){return epoch;}} as DateConstructor;
async function fingerprint(){
 const files:string[]=[];
 async function walk(relative:string):Promise<void>{for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})){const name=relative+'/'+entry.name;if(entry.isDirectory())await walk(name);else if(entry.isFile())files.push(name);}}
 await walk('services/sql/src');files.push('services/sql/package.json','package-lock.json');
 const hashes=await Promise.all(files.sort().map(async file=>[file,createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')]));
 return {compilerSourceSha256:await retainedCompilerFingerprint(root),sqlEngineSha256:nativeDigest({hashes,runtime:{node:process.versions.node,v8:process.versions.v8,icu:process.versions.icu,tz:process.versions.tz}})};
}
const host=await retainedNativeFlowHost({legacyRoot:root,fingerprint,queryFunctions(sql){const sha=createHash('sha256').update(sql).digest('hex'),matches=input.queryFunctions.filter(q=>q.sqlSha256===sha);if(matches.length!==1)throw Error('native_query_authorizer_receipt_missing');return matches[0]!.functions;}});
process.stdout.write(JSON.stringify(await compileNativeFlow({document:input.document,analysis:input.analysis,sqlEngineSha256:input.sqlEngineSha256,host,resolveCatalog:cachedNativeCatalogResolver(input.catalogs)})));
