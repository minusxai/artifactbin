/** Declarations contain names only. Credential values are never versioned with source. */
export interface PinnedBackendSecretScope {ownerId:string;backendId:string;pageId:string;secretBindings?:readonly string[]}
export interface BackendSecretScope {ownerId:string;backendId:string}
export interface BackendSecretCipher {seal(value:string,scope:BackendSecretScope,name:string):string;open(ciphertext:string,scope:BackendSecretScope,name:string):string}
export interface BackendSecretRepository {
 get(scope:BackendSecretScope,name:string):Promise<string|null>;
 put(scope:BackendSecretScope,name:string,ciphertext:string):Promise<void>;
 remove(scope:BackendSecretScope,name:string):Promise<void>;
 names(scope:BackendSecretScope):Promise<string[]>;
}
export function secretBindingNames(value:unknown):string[]{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>32||value.some(name=>typeof name!=='string'||!SECRET_NAME.test(name))||new Set(value).size!==value.length)throw Error('invalid_secret_bindings');
 return [...value].sort();
}
const SECRET_NAME=/^[A-Z][A-Z0-9_]{0,63}$/;
const HOST_LABEL='[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
/** A DNS name with at least two labels and an alphabetic top label, optionally behind one `*.` label (so never `*.com`). */
const SECRET_HOST=new RegExp(`^(?:\\*\\.)?(?:${HOST_LABEL}\\.)+[a-z][a-z0-9-]*[a-z0-9]$`);
/** The resolver `secrets` export: each name bound to the one host that may receive it. Returned sorted by name. */
export function secretHostMap(value:unknown):Record<string,string>{
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_secrets');
 const entries=Object.entries(value);
 if(entries.length>32||entries.some(([name,host])=>!SECRET_NAME.test(name)||typeof host!=='string'||host.length>253||!SECRET_HOST.test(host)))throw Error('invalid_secrets');
 return Object.fromEntries(entries.sort(([a],[b])=>a<b?-1:a>b?1:0));
}
export function createBackendSecrets(repository:BackendSecretRepository,cipher:BackendSecretCipher){
 return {
  names:(scope:BackendSecretScope)=>repository.names(scope),
  async put(scope:BackendSecretScope,name:string,value:string){secretBindingNames([name]);if(typeof value!=='string'||Buffer.byteLength(value)<1||Buffer.byteLength(value)>4096||value.includes('\0'))throw Error('invalid_secret');await repository.put(scope,name,cipher.seal(value,scope,name));},
  async remove(scope:BackendSecretScope,name:string){secretBindingNames([name]);await repository.remove(scope,name);},
  async get(scope:BackendSecretScope,declared:readonly string[],name:string){if(!declared.includes(name))throw Error('backend_secret_forbidden');const encrypted=await repository.get(scope,name);if(encrypted===null)throw Error('backend_secret_unavailable');try{return cipher.open(encrypted,scope,name);}catch{throw Error('backend_secret_unavailable');}},
 };
}
