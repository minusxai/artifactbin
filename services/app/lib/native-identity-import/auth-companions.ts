import type {Queryable} from '@artifactbin/contracts';
import type {NativeIdentityAuthCompanion,NativeIdentityMigrationAuthority,NativeIdentityMigrationSchemas} from './contracts';
import {nativeIdentityTimestamp} from './model';
const authorities=new WeakMap<object,{tx:Queryable;schemas:Readonly<NativeIdentityMigrationSchemas>}>();
/** Operator-only: verifies existing database authority, never grants it. Scopes are explicit host configuration. */
export async function authorizeNativeIdentityTransaction(tx:Queryable,schemas:NativeIdentityMigrationSchemas):Promise<NativeIdentityMigrationAuthority>{
 if(!schemas||![schemas.appSchema,schemas.authSchema].every(value=>typeof value==='string'&&/^[a-z_][a-z0-9_]{0,62}$/.test(value))||schemas.appSchema===schemas.authSchema)throw Error('native_identity_migration_scope_required');
 const scope=Object.freeze({appSchema:schemas.appSchema,authSchema:schemas.authSchema});
 const tables=[`"${scope.appSchema}".users`,`"${scope.appSchema}".tokens`,`"${scope.appSchema}".native_identity_imports`,`"${scope.authSchema}"."user"`];
 const checked=(await tx.query<{app_scope:boolean;permitted:boolean}>(`SELECT current_schema()=$1 AS app_scope,
 has_schema_privilege(current_user,$1,'USAGE') AND has_schema_privilege(current_user,$2,'USAGE') AND
 (SELECT bool_and(has_table_privilege(current_user,t,'SELECT') AND has_table_privilege(current_user,t,'INSERT') AND has_table_privilege(current_user,t,'UPDATE')) FROM unnest($3::text[]) AS t) AS permitted`,[scope.appSchema,scope.authSchema,tables])).rows[0];
 if(checked?.app_scope!==true||checked.permitted!==true)throw Error('native_identity_migration_authority_denied');
 const authority=Object.freeze({}) as NativeIdentityMigrationAuthority;authorities.set(authority,{tx,schemas:scope});return authority;
}
export async function nativeIdentityMigrationScope(tx:Queryable,authority:NativeIdentityMigrationAuthority):Promise<Readonly<NativeIdentityMigrationSchemas>>{
 const proof=authority&&typeof authority==='object'?authorities.get(authority):undefined;
 if(!proof||proof.tx!==tx)throw Error('native_identity_migration_authority_required');
 const current=(await tx.query<{schema:string}>('SELECT current_schema() AS schema')).rows[0];
 if(current?.schema!==proof.schemas.appSchema)throw Error('native_identity_migration_scope_changed');
 return proof.schemas;
}
/** Provision an address claim, never a verified identity, session, password or bearer.
 * The real auth service must have initialized its own schema before this stage. */
export async function provisionNativeIdentityAuthCompanion(tx:Queryable,input:NativeIdentityAuthCompanion,authority:NativeIdentityMigrationAuthority,mode:'create-or-preserve'|'verify-existing'='create-or-preserve'):Promise<'created'|'preserved'>{
 const schema=(await nativeIdentityMigrationScope(tx,authority)).authSchema;
 const table=`"${schema}"."user"`;
 const email=input.email.trim().toLowerCase();
 if(!input.id||!email||email!==input.email||!email.includes('@'))throw Error('native_identity_auth_invalid');
 const at=nativeIdentityTimestamp(input.provisionedAt);
 const read=()=>tx.query<{id:string;email:string}>(`SELECT id,email FROM ${table} WHERE id=$1 OR lower(trim(email))=$2 FOR UPDATE`,[input.id,email]);
 const rows=(await read()).rows;
 if(rows.length){if(rows.length!==1||rows[0]!.id!==input.id||rows[0]!.email!==email)throw Error('native_identity_auth_collision');return 'preserved';}
 if(mode==='verify-existing')throw Error('native_identity_auth_missing');
 await tx.query(`INSERT INTO ${table}(id,name,email,"emailVerified",image,"createdAt","updatedAt") VALUES($1,$2,$3,false,NULL,$4,$4)`,[input.id,input.name??'',email,at]);
 const checked=(await tx.query<{id:string;email:string;emailVerified:boolean;name:string;image:string|null;timestampsEqual:boolean}>(`SELECT id,email,"emailVerified",name,image,("createdAt"=$2 AND "updatedAt"=$2) AS "timestampsEqual" FROM ${table} WHERE id=$1`,[input.id,at])).rows[0];
 if(!checked||checked.id!==input.id||checked.email!==email||checked.emailVerified!==false||checked.name!==(input.name??'')||checked.image!==null||checked.timestampsEqual!==true)throw Error('native_identity_auth_verification_failed');
 return 'created';
}
/** Locked read of every address claim the replay checks, matched in memory by verifyNativeIdentityAuthCompanion. */
export async function readNativeIdentityAuthCompanions(tx:Queryable,authority:NativeIdentityMigrationAuthority,inputs:{id:string;email:string}[]):Promise<{id:string;email:string}[]>{
 const schema=(await nativeIdentityMigrationScope(tx,authority)).authSchema;
 if(!inputs.length)return [];
 return (await tx.query<{id:string;email:string}>(`SELECT id,email FROM "${schema}"."user" WHERE id=ANY($1::text[]) OR lower(trim(email))=ANY($2::text[]) FOR UPDATE`,[inputs.map(i=>i.id),inputs.map(i=>i.email.trim().toLowerCase())])).rows;
}
/** Same outcome as provisionNativeIdentityAuthCompanion(...,'verify-existing') against the prefetched rows. */
export function verifyNativeIdentityAuthCompanion(rows:{id:string;email:string}[],input:NativeIdentityAuthCompanion){
 const email=input.email.trim().toLowerCase();
 if(!input.id||!email||email!==input.email||!email.includes('@'))throw Error('native_identity_auth_invalid');
 const matches=rows.filter(row=>row.id===input.id||row.email.trim().toLowerCase()===email);
 if(!matches.length)throw Error('native_identity_auth_missing');
 if(matches.length!==1||matches[0]!.id!==input.id||matches[0]!.email!==email)throw Error('native_identity_auth_collision');
}
