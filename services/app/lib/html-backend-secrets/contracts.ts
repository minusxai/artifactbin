import {RESOLVER_DATABASE_BINDING,RESOLVER_DATABASE_LIMITS} from '@artifactbin/contracts';
import {hostNameSyntax} from '@artifactbin/utils/public-address';
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
/**
 * The resolver `secrets` export: each name bound to the one host that may receive it, or to `'postgres'` (a named
 * database connection, RESOLVER_DATABASE_BINDING, which `caps.fetch` never fills). Returned sorted by name.
 */
export function secretHostMap(value:unknown):Record<string,string>{
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_secrets');
 const entries=Object.entries(value);
 if(entries.length>32||entries.some(([name,host])=>!SECRET_NAME.test(name)||typeof host!=='string'||host.length>253||!(SECRET_HOST.test(host)||host===RESOLVER_DATABASE_BINDING)))throw Error('invalid_secrets');
 return Object.fromEntries(entries.sort(([a],[b])=>a<b?-1:a>b?1:0));
}
/**
 * A named Postgres connection's stored value. The password is the only secret part, and it enters the run
 * that uses the connection (services/runner database tunnel): page editors can read it, so owners should
 * configure a read-only database user. `tls` is `verify-full` (the default; `ca` adds a PEM root) or `disable`,
 * which only a development runner (`RUNNER__DATABASE_LOOPBACK`) accepts.
 */
export interface DatabaseConnection {host:string;port:number;database:string;user:string;password:string;tls:'verify-full'|'disable';ca?:string}
const CONNECTION_KEYS=new Set(['host','port','database','user','password','tls','ca']);
const text=(value:unknown,max:number)=>typeof value==='string'&&value.length>=1&&value.length<=max&&!/[\0-\x1f\x7f]/.test(value);
/** The validated, normalized connection, or `invalid_connection`. Address rules are enforced again where the socket opens. */
export function databaseConnection(value:unknown):DatabaseConnection{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!CONNECTION_KEYS.has(key)))throw Error('invalid_connection');
 const v=value as Record<string,unknown>,host=typeof v.host==='string'?hostNameSyntax(v.host):null,tls=v.tls??'verify-full';
 if(!host||typeof v.port!=='number'||!Number.isInteger(v.port)||v.port<RESOLVER_DATABASE_LIMITS.minPort||v.port>65535)throw Error('invalid_connection');
 if(!text(v.database,128)||!text(v.user,128)||!text(v.password,1024)||(tls!=='verify-full'&&tls!=='disable'))throw Error('invalid_connection');
 if(v.ca!==undefined&&(typeof v.ca!=='string'||v.ca.length>12*1024||!v.ca.includes('-----BEGIN CERTIFICATE-----')||v.ca.includes('\0')))throw Error('invalid_connection');
 return {host,port:v.port,database:v.database as string,user:v.user as string,password:v.password as string,tls,...(v.ca===undefined?{}:{ca:v.ca as string})};
}
export function createBackendSecrets(repository:BackendSecretRepository,cipher:BackendSecretCipher){
 return {
  names:(scope:BackendSecretScope)=>repository.names(scope),
  async put(scope:BackendSecretScope,name:string,value:string){secretBindingNames([name]);if(typeof value!=='string'||Buffer.byteLength(value)<1||Buffer.byteLength(value)>4096||value.includes('\0'))throw Error('invalid_secret');await repository.put(scope,name,cipher.seal(value,scope,name));},
  /** A connection is stored as one sealed JSON value under its declared name, in the same table and cipher as secrets. */
  async putConnection(scope:BackendSecretScope,name:string,connection:unknown){secretBindingNames([name]);await repository.put(scope,name,cipher.seal(JSON.stringify(databaseConnection(connection)),scope,name));},
  async remove(scope:BackendSecretScope,name:string){secretBindingNames([name]);await repository.remove(scope,name);},
  async get(scope:BackendSecretScope,declared:readonly string[],name:string){if(!declared.includes(name))throw Error('backend_secret_forbidden');const encrypted=await repository.get(scope,name);if(encrypted===null)throw Error('backend_secret_unavailable');try{return cipher.open(encrypted,scope,name);}catch{throw Error('backend_secret_unavailable');}},
 };
}
