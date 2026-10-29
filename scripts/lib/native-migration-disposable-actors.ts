import {createHash} from 'node:crypto';
import path from 'node:path';
import {realpath} from 'node:fs/promises';
import { type Db, DATABASE_URL, LOCAL_OBJECT_DIR, S3_URL } from '../../services/app/lib/platform';
import { mintToken, revokeToken, MIN_TOKEN_TTL_MS, DEFAULT_TOKEN_TTL_MS } from '@/lib/accounts';
import {verifyNativeIdentityInput, type NativeIdentityImport} from '../../services/app/lib/native-identity-import';
import type {NativeDisposableRuntimeActorPort,NativeDisposableRuntimeActorReceipt} from './native-migration-disposable-actors-contract';
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
/** Mints only inside the concrete isolated store. Bearers are discarded, never serialized or returned. */
export async function createNativeDisposableRuntimeActors(input:{db:Db;storageRoot:string;origin:string;ttlMs:number;identity:NativeIdentityImport}):Promise<NativeDisposableRuntimeActorPort&{dispose():Promise<NativeDisposableRuntimeActorReceipt>}>{
 const {db,ttlMs}=input,identity=structuredClone(input.identity),origin=new URL(input.origin),root=await realpath(input.storageRoot);
 if(db.raw().kind!=='pglite'||S3_URL||typeof DATABASE_URL!=='string'||!DATABASE_URL.startsWith('pglite://')||!path.resolve(DATABASE_URL.slice('pglite://'.length)).startsWith(root+path.sep)||path.resolve(LOCAL_OBJECT_DIR)!==path.join(root,'objects')||!['http:','https:'].includes(origin.protocol)||!['localhost','127.0.0.1','lvh.me','app.lvh.me'].includes(origin.hostname)&&!origin.hostname.endsWith('.lvh.me')||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('native_disposable_actor_local_scope');
 if(!Number.isSafeInteger(ttlMs)||ttlMs<MIN_TOKEN_TTL_MS||ttlMs>DEFAULT_TOKEN_TTL_MS)throw Error('native_disposable_actor_ttl');
 verifyNativeIdentityInput(identity);
 const allowed=new Set(identity.plan.users.map(mapping=>mapping.targetId)),tokens:{userId:string;tokenId:string;expiresAt:string;revoked:boolean}[]=[];let closed=false;const pending=new Set<Promise<{userId:string;tokenId:string}>>();
 return {provision(tx,userId){
  if(closed||!allowed.has(userId))return Promise.reject(Error('native_disposable_actor_mapping'));
  const work=(async()=>{
  const user=(await tx.query<{id:string;kind:string;email:string|null}>('SELECT id,kind,email FROM users WHERE id=$1',[userId])).rows[0];
  if(!user||user.kind!=='account'||!user.email)throw Error('native_disposable_actor_account');
  const token=await mintToken('native-disposable-runtime',userId,tx,{expiresInMs:ttlMs,audience:origin.origin});
  if(!token.expiresAt)throw Error('native_disposable_actor_expiry');
  tokens.push({userId,tokenId:token.id,expiresAt:token.expiresAt,revoked:false});
  return {userId,tokenId:token.id};
  })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});return work;
 },async dispose(){closed=true;await Promise.allSettled([...pending]);const results=await Promise.allSettled(tokens.map(async token=>{if(!token.revoked){await revokeToken(token.tokenId);token.revoked=true;}}));
  const receipt:NativeDisposableRuntimeActorReceipt={format:'native-disposable-runtime-actors-v1',identityPlanSha256:identity.plan.sha256,tokens:tokens.map(({tokenId,...token})=>({...token,tokenIdSha256:sha(tokenId)}))};
  if(results.some(result=>result.status==='rejected'))throw Error('native_disposable_actor_revoke');return receipt;
 }};
}
