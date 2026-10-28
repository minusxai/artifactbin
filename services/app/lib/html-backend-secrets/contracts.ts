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
 if(!Array.isArray(value)||value.length>32||value.some(name=>typeof name!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/.test(name))||new Set(value).size!==value.length)throw Error('invalid_secret_bindings');
 return [...value].sort();
}
export function createBackendSecrets(repository:BackendSecretRepository,cipher:BackendSecretCipher){
 return {
  names:(scope:BackendSecretScope)=>repository.names(scope),
  async put(scope:BackendSecretScope,name:string,value:string){secretBindingNames([name]);if(typeof value!=='string'||Buffer.byteLength(value)<1||Buffer.byteLength(value)>4096||value.includes('\0'))throw Error('invalid_secret');await repository.put(scope,name,cipher.seal(value,scope,name));},
  async remove(scope:BackendSecretScope,name:string){secretBindingNames([name]);await repository.remove(scope,name);},
  async get(scope:BackendSecretScope,declared:readonly string[],name:string){if(!declared.includes(name))throw Error('backend_secret_forbidden');const encrypted=await repository.get(scope,name);if(encrypted===null)throw Error('backend_secret_unavailable');try{return cipher.open(encrypted,scope,name);}catch{throw Error('backend_secret_unavailable');}},
 };
}
