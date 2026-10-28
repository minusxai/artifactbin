import {createHash} from 'node:crypto';
import type {NativeRuntimeObjectVerification,NativeRuntimeObjectVerificationPorts,NativeRuntimePreparation} from './contracts';
/** Four independent reads per wave; settle every started check before returning. */
export async function verifyNativeRuntimeObjects(dependencies:readonly NativeRuntimeObjectVerification[],ports:NativeRuntimeObjectVerificationPorts):Promise<NativeRuntimePreparation['objects']>{
 const objects:NativeRuntimePreparation['objects'][number][]=[];
 const verify=async(dependency:NativeRuntimeObjectVerification):Promise<NativeRuntimePreparation['objects'][number]>=>{
  const row=await ports.readOwned(dependency.id),expected=Buffer.from(dependency.expected),sha256=createHash('sha256').update(expected).digest('hex');
  if(!row||row.format!=='file'||String(row.version)!==dependency.revision)throw Error('native_runtime_invalid');
  const meta=row.meta;
  if(typeof meta.objectKey!=='string'||meta.sha256!==sha256||meta.bytes!==expected.byteLength||meta.contentType!==dependency.contentType)throw Error('native_runtime_invalid');
  const actual=Buffer.from(await ports.readObject(meta.objectKey));
  if(!actual.equals(expected))throw Error('native_runtime_invalid');
  return {path:dependency.path,id:dependency.id,revision:dependency.revision,objectKey:meta.objectKey,sha256,bytes:actual.byteLength,contentType:dependency.contentType};
 };
 for(let offset=0;offset<dependencies.length;offset+=4){
  const settled=await Promise.allSettled(dependencies.slice(offset,offset+4).map(verify));
  const failure=settled.find((result):result is PromiseRejectedResult=>result.status==='rejected');
  if(failure)throw failure.reason;
  for(const result of settled)if(result.status==='fulfilled')objects.push(result.value);
 }
 return objects;
}
