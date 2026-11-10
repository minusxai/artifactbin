import {isResolverDatabaseKind,MINUSX_CONNECTION_KIND,RESOLVER_DATABASE_KINDS,RESOLVER_DATABASE_LIMITS,type ResolverDatabaseKind} from '@artifactbin/contracts';
import {hostNameSyntax} from '@artifactbin/utils/public-address';
/** Declarations contain names only. Credential values are never versioned with source. */
/** `secretHosts`: each declared name's host or kind; a group-owned page reads only its governed (`'minusx'`) names. */
export interface PinnedBackendSecretScope {ownerId:string;backendId:string;pageId:string;secretBindings?:readonly string[];secretHosts?:Readonly<Record<string,string>>}
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
 * The resolver `secrets` export: each name bound to the one host that may receive it, or to a database kind of
 * RESOLVER_DATABASE_KINDS (`'postgres'`, `'mysql'`: a named connection for `caps.db`, which `caps.fetch` never fills),
 * or to MINUSX_CONNECTION_KIND (`'minusx'`: a `caps.db` connection through a governed MinusX connection, combined mode
 * only, refused at publish otherwise). A value that is neither is refused with its name and the supported kinds, which publish shows as is.
 * Returned sorted by name.
 */
export function secretHostMap(value:unknown):Record<string,string>{
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_secrets');
 const entries=Object.entries(value);
 if(entries.length>32)throw Error('invalid_secrets: at most 32 names');
 for(const [name,host] of entries){
  if(!SECRET_NAME.test(name))throw Error(`invalid_secrets: ${JSON.stringify(name.slice(0,64))} is not an upper-case name`);
  if(typeof host==='string'&&host.length<=253&&(SECRET_HOST.test(host)||isResolverDatabaseKind(host)||host===MINUSX_CONNECTION_KIND))continue;
  const shown=typeof host==='string'?JSON.stringify(host.slice(0,64)):typeof host;
  throw Error(`invalid_secrets: ${name}: ${shown} is neither a host name (exact or one leading *. label) nor a database type (${RESOLVER_DATABASE_KINDS.join(', ')})`);
 }
 return Object.fromEntries(entries.sort(([a],[b])=>a<b?-1:a>b?1:0));
}
/**
 * A named database connection's stored value; `kind` is the one its resolver declared (RESOLVER_DATABASE_KINDS),
 * so a later version that declares the name as another kind cannot use it. The password is the only secret part:
 * it goes to the runner worker's driver, outside the isolate, and never reaches resolver code (services/runner
 * database tunnel). Owners should still configure a read-only database user: resolver code runs any SQL that user
 * may. `tls` is `verify-full` (the default; `ca` adds a PEM root) or `disable`, which only a development runner
 * (`RUNNER__DATABASE_LOOPBACK`) accepts.
 */
export interface DatabaseConnection {kind:ResolverDatabaseKind;host:string;port:number;database:string;user:string;password:string;tls:'verify-full'|'disable';ca?:string}
const CONNECTION_KEYS=new Set(['kind','host','port','database','user','password','tls','ca']);
const text=(value:unknown,max:number)=>typeof value==='string'&&value.length>=1&&value.length<=max&&!/[\0-\x1f\x7f]/.test(value);
/** The validated, normalized connection, or `invalid_connection`. Address rules are enforced again where the socket opens. */
export function databaseConnection(value:unknown):DatabaseConnection{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!CONNECTION_KEYS.has(key)))throw Error('invalid_connection');
 const v=value as Record<string,unknown>,host=typeof v.host==='string'?hostNameSyntax(v.host):null,tls=v.tls??'verify-full';
 if(!isResolverDatabaseKind(v.kind))throw Error('invalid_connection');
 if(!host||typeof v.port!=='number'||!Number.isInteger(v.port)||v.port<RESOLVER_DATABASE_LIMITS.minPort||v.port>65535)throw Error('invalid_connection');
 if(!text(v.database,128)||!text(v.user,128)||!text(v.password,1024)||(tls!=='verify-full'&&tls!=='disable'))throw Error('invalid_connection');
 if(v.ca!==undefined&&(typeof v.ca!=='string'||v.ca.length>12*1024||!v.ca.includes('-----BEGIN CERTIFICATE-----')||v.ca.includes('\0')))throw Error('invalid_connection');
 return {kind:v.kind,host,port:v.port,database:v.database as string,user:v.user as string,password:v.password as string,tls,...(v.ca===undefined?{}:{ca:v.ca as string})};
}
export function createBackendSecrets(repository:BackendSecretRepository,cipher:BackendSecretCipher){
 return {
  names:(scope:BackendSecretScope)=>repository.names(scope),
  async put(scope:BackendSecretScope,name:string,value:string){secretBindingNames([name]);if(typeof value!=='string'||Buffer.byteLength(value)<1||Buffer.byteLength(value)>4096||value.includes('\0'))throw Error('invalid_secret');await repository.put(scope,name,cipher.seal(value,scope,name));},
  /**
   * A connection is stored as one sealed JSON value under its declared name, in the same table and cipher as secrets,
   * with the kind the name is declared as; a body naming another kind is refused.
   */
  async putConnection(scope:BackendSecretScope,name:string,kind:ResolverDatabaseKind,connection:unknown){
   secretBindingNames([name]);
   if(!connection||typeof connection!=='object'||Array.isArray(connection)||((connection as {kind?:unknown}).kind??kind)!==kind)throw Error('invalid_connection');
   await repository.put(scope,name,cipher.seal(JSON.stringify(databaseConnection({...connection,kind})),scope,name));
  },
  async remove(scope:BackendSecretScope,name:string){secretBindingNames([name]);await repository.remove(scope,name);},
  async get(scope:BackendSecretScope,declared:readonly string[],name:string){if(!declared.includes(name))throw Error('backend_secret_forbidden');const encrypted=await repository.get(scope,name);if(encrypted===null)throw Error('backend_secret_unavailable');try{return cipher.open(encrypted,scope,name);}catch{throw Error('backend_secret_unavailable');}},
 };
}
