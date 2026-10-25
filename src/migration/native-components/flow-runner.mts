/** Isolated retained schema compilation only; no credentials, network or destination writes. */
import path from 'node:path';
import {createHash} from 'node:crypto';
import {retainedNativeFlowFingerprint} from './flow-fingerprint.ts';
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
const host=await retainedNativeFlowHost({legacyRoot:root,fingerprint:()=>retainedNativeFlowFingerprint(root),queryFunctions(sql){const sha=createHash('sha256').update(sql).digest('hex'),matches=input.queryFunctions.filter(q=>q.sqlSha256===sha);if(matches.length>1)throw Error('native_query_authorizer_receipt_ambiguous');return matches[0]?.functions;}});
process.stdout.write(JSON.stringify(await compileNativeFlow({document:input.document,analysis:input.analysis,sqlEngineSha256:input.sqlEngineSha256,host,resolveCatalog:cachedNativeCatalogResolver(input.catalogs)})));
