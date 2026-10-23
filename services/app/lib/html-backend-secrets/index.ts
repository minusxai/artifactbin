import {createBackendSecretCipher} from './cipher';
import {AUTH_SECRET} from '@/lib/platform/config';
import {getDb} from '@/lib/platform/db';
import {createBackendSecrets,type BackendSecretScope} from './contracts';
const backendSecretCipher=createBackendSecretCipher(AUTH_SECRET);
const args=(s:BackendSecretScope,n?:string)=>n===undefined?[s.ownerId,s.backendId]:[s.ownerId,s.backendId,n];
export const backendSecrets=createBackendSecrets({
 async get(s,n){return (await(await getDb()).query<{ciphertext:string}>('SELECT ciphertext FROM html_backend_secrets WHERE owner_id=$1 AND backend_id=$2 AND name=$3',args(s,n))).rows[0]?.ciphertext??null;},
 async put(s,n,v){await(await getDb()).query('INSERT INTO html_backend_secrets(owner_id,backend_id,name,ciphertext) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,backend_id,name) DO UPDATE SET ciphertext=EXCLUDED.ciphertext',[...args(s,n),v]);},
 async remove(s,n){await(await getDb()).query('DELETE FROM html_backend_secrets WHERE owner_id=$1 AND backend_id=$2 AND name=$3',args(s,n));},
 async names(s){return (await(await getDb()).query<{name:string}>('SELECT name FROM html_backend_secrets WHERE owner_id=$1 AND backend_id=$2 ORDER BY name',args(s))).rows.map(r=>r.name);},
},backendSecretCipher);
