import {createHash} from 'node:crypto';
import type {NativeIdentityImport,NativeIdentityAvatarPreparation} from './contracts';
import {verifyNativeIdentityInput,nativeIdentityDigest} from './model';
const prepared=new WeakMap<NativeIdentityAvatarPreparation,{plan:string;receipts:string;objects:Map<string,{key:string;sha256:string}>}>();
/** Reviewed source object bytes, exact source image key, immutable destination readback. */
export async function prepareNativeIdentityAvatars(raw:NativeIdentityImport,sink:{get(key:string):Promise<Buffer>;putIfAbsent(key:string,bytes:Buffer):Promise<'created'|'exists'>}):Promise<NativeIdentityAvatarPreparation>{
 const input=structuredClone(raw),proof=input.avatarObjects?.length?verifyNativeIdentityInput(input):undefined,objects=new Map<string,{key:string;sha256:string}>(),targets=new Map<string,string>();
 for(const object of input.avatarObjects??[]){
  const mapping=input.plan.users.find(m=>m.sourceId===object.sourceId),source=proof!.users.get(object.sourceId);
  if(!mapping||mapping.action!=='reuse-verified-email'||!source?.image_key||source.image_key!==object.key||objects.has(object.sourceId)||!/^avatar\//.test(object.key)||!/^[a-f0-9]{64}$/.test(object.sha256))throw Error('native_identity_avatar_source');
  const prior=targets.get(mapping.targetId);if(prior&&prior!==object.key)throw Error('native_identity_avatar_ambiguous');targets.set(mapping.targetId,object.key);
  if(!/^[-A-Za-z0-9_./]+$/.test(object.key)||object.key.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('native_identity_avatar_key');
  const bytes=Buffer.from(object.base64,'base64'),sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
  if(!bytes.length||bytes.toString('base64')!==object.base64||sha(bytes)!==object.sha256)throw Error('native_identity_avatar_digest');
  await sink.putIfAbsent(object.key,bytes);
  if(sha(await sink.get(object.key))!==object.sha256)throw Error('native_identity_avatar_object');
  objects.set(object.sourceId,{key:object.key,sha256:object.sha256});
 }
 const authority={} as NativeIdentityAvatarPreparation;prepared.set(authority,{plan:input.plan.sha256,receipts:nativeIdentityDigest(input.avatarObjects??[]),objects});return authority;
}
export function nativeIdentityAvatarObject(input:NativeIdentityImport,sourceId:string,authority?:NativeIdentityAvatarPreparation){
 if(!authority){if(input.avatarObjects?.length)throw Error('native_identity_avatar_not_staged');return undefined;}
 const proof=prepared.get(authority);if(!proof||proof.plan!==input.plan.sha256||proof.receipts!==nativeIdentityDigest(input.avatarObjects??[]))throw Error('native_identity_avatar_authority');
 const object=proof.objects.get(sourceId),receipt=input.avatarObjects?.find(o=>o.sourceId===sourceId);
 if(object&&(!receipt||receipt.key!==object.key||receipt.sha256!==object.sha256))throw Error('native_identity_avatar_authority');
 return object;
}
