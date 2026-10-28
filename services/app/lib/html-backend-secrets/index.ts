import {createBackendSecretCipher} from './cipher';
import {AUTH_SECRET} from '@/lib/platform/config';
import {getDb} from '@/lib/platform/db';
import {createBackendSecrets,type BackendSecretScope,type PinnedBackendSecretScope} from './contracts';
const backendSecretCipher=createBackendSecretCipher(AUTH_SECRET);
const args=(s:BackendSecretScope,n?:string)=>n===undefined?[s.ownerId,s.backendId]:[s.ownerId,s.backendId,n];
export const backendSecrets=createBackendSecrets({
 async get(s,n){return (await(await getDb()).query<{ciphertext:string}>('SELECT ciphertext FROM html_backend_secrets WHERE owner_id=$1 AND backend_id=$2 AND name=$3',args(s,n))).rows[0]?.ciphertext??null;},
 async put(s,n,v){await(await getDb()).query('INSERT INTO html_backend_secrets(owner_id,backend_id,name,ciphertext) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,backend_id,name) DO UPDATE SET ciphertext=EXCLUDED.ciphertext',[...args(s,n),v]);},
 async remove(s,n){await(await getDb()).query('DELETE FROM html_backend_secrets WHERE owner_id=$1 AND backend_id=$2 AND name=$3',args(s,n));},
 async names(s){return (await(await getDb()).query<{name:string}>('SELECT name FROM html_backend_secrets WHERE owner_id=$1 AND backend_id=$2 ORDER BY name',args(s))).rows.map(r=>r.name);},
},backendSecretCipher);

/** Read ciphertext and current personal ownership in one database snapshot. Transfers never carry credentials. */
export async function readPinnedBackendSecret(backend:PinnedBackendSecretScope,name:string):Promise<string>{
 if(!backend.secretBindings?.includes(name))throw Error('backend_secret_forbidden');
 const row=(await(await getDb()).query<{ciphertext:string}>(`SELECT s.ciphertext FROM html_backend_secrets s JOIN artifacts a ON a.id=$4 AND a.user_id=s.owner_id AND a.group_id IS NULL AND a.deleted_at IS NULL WHERE s.owner_id=$1 AND s.backend_id=$2 AND s.name=$3`,[backend.ownerId,backend.backendId,name,backend.pageId])).rows[0];
 if(!row)throw Error('backend_secret_unavailable');
 try{return backendSecretCipher.open(row.ciphertext,{ownerId:backend.ownerId,backendId:backend.backendId},name);}catch{throw Error('backend_secret_unavailable');}
}
