import type {Queryable} from '@artifactbin/contracts';
import type {NativeIdentityAuthCompanion} from './contracts';
import {nativeIdentityTimestamp} from './model';
/** Provision an address claim, never a verified identity, session, password or bearer.
 * The real auth service must have initialized its own schema before this stage. */
export async function provisionNativeIdentityAuthCompanion(tx:Queryable,input:NativeIdentityAuthCompanion,mode:'create-or-preserve'|'verify-existing'='create-or-preserve'):Promise<'created'|'preserved'>{
 const email=input.email.trim().toLowerCase();
 if(!input.id||!email||email!==input.email||!email.includes('@'))throw Error('native_identity_auth_invalid');
 const at=nativeIdentityTimestamp(input.provisionedAt);
 const read=()=>tx.query<{id:string;email:string}>(`SELECT id,email FROM auth."user" WHERE id=$1 OR lower(trim(email))=$2 FOR UPDATE`,[input.id,email]);
 const rows=(await read()).rows;
 if(rows.length){if(rows.length!==1||rows[0]!.id!==input.id||rows[0]!.email!==email)throw Error('native_identity_auth_collision');return 'preserved';}
 if(mode==='verify-existing')throw Error('native_identity_auth_missing');
 await tx.query(`INSERT INTO auth."user"(id,name,email,"emailVerified",image,"createdAt","updatedAt") VALUES($1,$2,$3,false,NULL,$4,$4)`,[input.id,input.name??'',email,at]);
 const checked=(await tx.query<{id:string;email:string;emailVerified:boolean;name:string;image:string|null;timestampsEqual:boolean}>(`SELECT id,email,"emailVerified",name,image,("createdAt"=$2 AND "updatedAt"=$2) AS "timestampsEqual" FROM auth."user" WHERE id=$1`,[input.id,at])).rows[0];
 if(!checked||checked.id!==input.id||checked.email!==email||checked.emailVerified!==false||checked.name!==(input.name??'')||checked.image!==null||checked.timestampsEqual!==true)throw Error('native_identity_auth_verification_failed');
 return 'created';
}
