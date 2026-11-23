/** Disposable signing host for exercising tenant refresh through the composed HTTP sign-in door. */
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import type {Queryable} from '@artifactbin/contracts/db';

export async function tenancyIssuer(db:Queryable) {
 const parentGroup='audit_operators';
 await db.query("INSERT INTO auth.groups(id,handle,name,created_by) VALUES('grp_audit_operators',$1,'Operators','fixture')",[parentGroup]);
 const keys = generateKeyPairSync('ed25519');
 const origin = 'https://host.example', issuer = 'audit-host', audience = 'audit-app';
 const env = {TRUSTED_SIGNIN__ISSUERS: JSON.stringify([{issuer,audience,parentGroup,origins:[origin],publicJwk:keys.publicKey.export({format:'jwk'})}])};
 const part = (value:unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
 function request(tenancyId:string, subject:string) {
  const now = Math.floor(Date.now()/1000);
  const claims = {iss:issuer,aud:audience,iat:now,exp:now+120,jti:randomUUID(),sub:subject,groups:[{handle:'host_team',tenancy_id:tenancyId,parent_handles:[parentGroup]}]};
  const message = part({alg:'EdDSA'})+'.'+part(claims);
  const token = message+'.'+sign(null,Buffer.from(message),keys.privateKey).toString('base64url');
  return new Request('http://localhost:3000/api/auth/trusted-sign-in',{method:'POST',headers:{origin},body:new URLSearchParams({token})});
 }
 return {env,request};
}
