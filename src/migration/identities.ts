import {createHash} from 'node:crypto';
import {planMigrationGroups} from './groups.ts';
import {emailAddress} from '../email.ts';
import type {MigrationManifest} from './contracts.ts';
import type {IdentityMigrationPlan} from './identity-contracts.ts';
export const isPreservedNonloginActor=(actor:string):boolean=>/^legacy-(?:user|token):[a-f0-9]{64}$/.test(actor);
/** Existing unique no-email users retain a nonlogin identity, never a fabricated email/credential. */
export function planMigrationIdentities(manifest:MigrationManifest):IdentityMigrationPlan {
 const result:IdentityMigrationPlan={maps:{users:{},tokens:{},groups:{},pages:{}},identities:[]};
 const counts=new Map<string,number>();
 for(const user of manifest.tables.users??[]){const id=typeof user.id==='string'?user.id:'';counts.set(id,(counts.get(id)??0)+1);}
 for(const user of manifest.tables.users??[]){
  const id=typeof user.id==='string'?user.id:'';
  if(!id||counts.get(id)!==1){result.identities.push({legacyUserId:id,actor:null,classification:'blocked',reason:'Missing or ambiguous legacy user key'});continue;}
  if(user.email===null||user.email===undefined||typeof user.email==='string'&&!user.email.trim()){
   const actor='legacy-user:'+createHash('sha256').update(JSON.stringify([manifest.sourceNamespace,id])).digest('hex');
   result.maps.users[id]=actor;result.identities.push({legacyUserId:id,actor,classification:'preserved-nonlogin',reason:'Existing identity preserved without login, credentials, handles, or restored account access'});continue;
  }
  let actor:string;try{actor=emailAddress(user.email);}catch{result.identities.push({legacyUserId:id,actor:null,classification:'blocked',reason:'Invalid nonempty legacy email'});continue;}
  result.maps.users[id]=actor;result.identities.push({legacyUserId:id,actor,classification:'email-login',reason:'Current normalized email identity'});
 }
 const tokenCounts=new Map<string,number>();for(const token of manifest.tokenOwners)tokenCounts.set(token.id,(tokenCounts.get(token.id)??0)+1);
 for(const token of manifest.tokenOwners){
  if(!token.id||tokenCounts.get(token.id)!==1){result.identities.push({legacyUserId:'',legacyTokenId:token.id,actor:null,classification:'blocked',reason:'Missing or ambiguous token owner key'});continue;}
  if(token.user_id!==null){const actor=result.maps.users[token.user_id];if(actor)result.maps.tokens[token.id]=actor;else result.identities.push({legacyUserId:token.user_id,legacyTokenId:token.id,actor:null,classification:'blocked',reason:'Token references an unmapped user'});continue;}
  const actor='legacy-token:'+createHash('sha256').update(JSON.stringify([manifest.sourceNamespace,token.id])).digest('hex');
  result.maps.tokens[token.id]=actor;result.identities.push({legacyUserId:'',legacyTokenId:token.id,actor,classification:'preserved-nonlogin',reason:'Existing anonymous token ownership and attribution preserved without credentials or restored account access'});
 }
 for(const group of planMigrationGroups(manifest,result.maps.users).groups)result.maps.groups[group.legacyId]=group.actor;
 return result;
}
