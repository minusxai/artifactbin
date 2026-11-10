/**
 * THE DELEGATION TOKEN (contract §3): Artifactbin vouching to MinusX, for ONE request, that `sub` asks under ONE
 * group. Signed here with the installation's Ed25519 key (`jose`, EdDSA), 60 s of life, a fresh `jti`, and the hex
 * SHA-256 of the exact body bytes the request then sends. Minted only on the server, per request, and handed only to
 * the MinusX client's Authorization header: never to page code, a URL, a log line, a stored row or a response.
 */
import {createHash,createPrivateKey,randomUUID,type KeyObject} from 'node:crypto';
import {SignJWT} from 'jose';
import {DELEGATION_AUDIENCE,DELEGATION_ISSUER,DELEGATION_TTL_SECONDS,DELEGATION_TYPE,type DelegationClaims,type DelegationPurpose} from '@artifactbin/contracts';
import type {MinusxSettings} from '@/lib/platform';

/** Who the request is for: the user Artifactbin vouches for and the group it runs under, never anything page code supplied. */
export interface DelegationSubject {userId:string;groupId:string;pageId?:string;pageVersion?:string;sessionRef?:string}

let key:{pem:string;object:KeyObject}|undefined;
const signingKey=(pem:string)=>(key?.pem===pem?key:key={pem,object:createPrivateKey({key:pem,format:'pem'})}).object;

const bodyDigest=(body:string|Uint8Array)=>createHash('sha256').update(body).digest('hex');

export async function mintDelegation(settings:MinusxSettings,subject:DelegationSubject,purpose:DelegationPurpose,body:string,now=Date.now()):Promise<string>{
 const iat=Math.floor(now/1000);
 const claims:Omit<DelegationClaims,'iss'|'aud'|'sub'|'iat'|'exp'|'jti'>={
  act:{sub:DELEGATION_ISSUER},installation_id:settings.installationId,active_group_id:subject.groupId,
  ...(subject.sessionRef?{session_ref:subject.sessionRef}:{}),...(subject.pageId?{page_id:subject.pageId}:{}),...(subject.pageVersion?{page_version:subject.pageVersion}:{}),
  purpose,request_sha256:bodyDigest(body),
 };
 return new SignJWT({...claims})
  .setProtectedHeader({alg:'EdDSA',typ:DELEGATION_TYPE,kid:settings.delegationKeyId})
  .setIssuer(DELEGATION_ISSUER).setAudience(DELEGATION_AUDIENCE).setSubject(subject.userId)
  .setIssuedAt(iat).setExpirationTime(iat+DELEGATION_TTL_SECONDS).setJti(randomUUID())
  .sign(signingKey(settings.delegationPrivateKey));
}
