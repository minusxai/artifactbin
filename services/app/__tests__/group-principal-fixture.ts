/**
 * THE FIXTURE for the group-principal-* tests (an agent signed in as a group: lib/accounts `GroupPrincipal`), one
 * composed host (the real identity host in front of the app) and one three-level tree, Root > Team > Squad: Ada
 * created all three, Eve edits Team. `world` also publishes the pages each kind of reach needs, unless asked not to.
 */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {beforeEach,expect,onTestFinished} from 'vitest';
import {createAuthComposedHost} from '@/test/helpers/auth-host';
import {AUTH_SECRET,getDb} from '@/lib/platform';
import { syncIdentitySettings } from '@/lib/platform/testing';
import {overrideConfig} from '@/lib/platform/config';
import {createGroup} from '@/lib/groups';
import {admitGroupMember} from './harness';
import {tempDir} from '@artifactbin/test-support/temp-dir';
import {otpSignIn} from '../../auth/__tests__/helpers';

export const SECRET='group-access-test-service-secret',origin='http://localhost:3000';
let directory='';
/** Each test: this installation's settings, and a fresh outbox for its sign-in codes. */
export function useGroupPrincipalHost():void{
 beforeEach(async()=>{overrideConfig({internalServiceSecret:SECRET,publicBaseUrl:origin});await syncIdentitySettings(await getDb());directory=await tempDir('group-access-',onTestFinished);});
}

export const sql=async<T=Record<string,unknown>>(text:string,params:unknown[]=[])=>(await (await getDb()).query<T>(text,params)).rows;
const otpOf=async(email:string)=>(await readFile(join(directory,'outbox.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(message=>message.to===email).at(-1).otp as string;

/** The composed host; `env` adds identity settings (a test's service audiences). */
export async function composed(env:Record<string,string>={}){
 const application=await createAuthComposedHost({APP__PUBLIC_BASE_URL:origin,AUTH__SECRET:AUTH_SECRET,INTERNAL__SERVICE_SECRET:SECRET,EMAIL__DEV_OUTBOX_PATH:join(directory,'outbox.jsonl'),...env});
 const fetch=(request:Request)=>application.fetch(request);
 const call=async(method:string,path:string,token:string,body?:unknown)=>{
  const response=await fetch(new Request(origin+path,{method,headers:{authorization:`Bearer ${token}`,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return {status:response.status,body:await response.json().catch(()=>null) as Record<string,unknown>|null};
 };
 const signIn=async(email:string)=>{
  const post=(path:string,body:unknown,headers:Record<string,string>={})=>fetch(new Request(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
  const {login,cookie}=await otpSignIn(post,email,()=>otpOf(email),{prefix:'/api/auth'});
  expect(login.status).toBe(200);
  const grant=await (await post('/api/authentication/token',{},{cookie})).json() as {access_token:string};
  const userId=(await sql<{id:string}>('SELECT id FROM users WHERE email=$1',[email]))[0]!.id;
  /** This person signs an agent in as `group` at `role`: the agent's bearer and its token row. */
  const asGroup=async(group:string,role:'member'|'editor')=>{
   const issued=await (await post('/api/authentication/token',{group_id:group,group_role:role},{cookie})).json() as {access_token:string;id:string};
   return {token:issued.access_token,tokenId:issued.id};
  };
  return {cookie,token:grant.access_token,userId,asGroup};
 };
 return {fetch,call,signIn};
}

export const page=(title:string)=>`<!doctype html><html><head></head><body><h1>${title}</h1><p data-af-id="intro">Body of ${title}</p></body></html>`;

/** The tree and its pages: who owns each, and how each is shared. */
export async function world(host:Awaited<ReturnType<typeof composed>>,withPages=true,eveRole:'member'|'admin'='admin'){
 const ada=await host.signIn('mxmx_test_ga_ada@example.test'),eve=await host.signIn('mxmx_test_ga_eve@example.test');
 const root=await createGroup(ada.userId,{handle:'ga_root',name:'Root'});
 const team=await createGroup(ada.userId,{handle:'ga_team',name:'Team',parent_id:root.id});
 const squad=await createGroup(ada.userId,{handle:'ga_squad',name:'Squad',parent_id:team.id});
 await admitGroupMember(ada.userId,team.id,eve.userId,eveRole);
 const publish=async(token:string,title:string,extra:Record<string,unknown>={})=>{
  const made=await host.call('POST','/api/artifacts',token,{title,html:page(title),...extra});
  expect(made.status,`${title}: ${JSON.stringify(made.body)}`).toBe(201);
  return String(made.body!.id);
 };
 const none:Record<'root'|'team'|'squad'|'personal'|'emailed'|'sharedTeam'|'sharedRoot'|'sharedSquad'|'linkCommenter',string>={root:'',team:'',squad:'',personal:'',emailed:'',sharedTeam:'',sharedRoot:'',sharedSquad:'',linkCommenter:''};
 if(!withPages)return {ada,eve,root,team,squad,pages:none};
 const pages={
  root:await publish(ada.token,'Root page',{destination:{type:'group',id:root.id},visibility:'private'}),
  team:await publish(eve.token,'Team page',{destination:{type:'group',id:team.id},visibility:'private'}),
  squad:await publish(ada.token,'Squad page',{destination:{type:'group',id:squad.id},visibility:'private'}),
  personal:await publish(ada.token,'Ada personal',{destination:{type:'personal'},visibility:'private'}),
  emailed:await publish(ada.token,'Emailed to Eve',{destination:{type:'personal'},visibility:'private',shares:[{email:'mxmx_test_ga_eve@example.test',role:'editor'}]}),
  sharedTeam:await publish(ada.token,'Shared with Team',{destination:{type:'personal'},visibility:'private'}),
  sharedRoot:await publish(ada.token,'Shared with Root',{destination:{type:'personal'},visibility:'private'}),
  sharedSquad:await publish(ada.token,'Shared with Squad',{destination:{type:'personal'},visibility:'private'}),
  linkCommenter:await publish(ada.token,'Link commenter',{destination:{type:'personal'},visibility:'unlisted',linkRole:'commenter'}),
 };
 for(const [id,group,role] of [[pages.sharedTeam,team.id,'commenter'],[pages.sharedRoot,root.id,'viewer'],[pages.sharedSquad,squad.id,'editor']] as const)
  expect((await host.call('PUT',`/api/artifacts/${id}/group-shares/${group}`,ada.token,{role})).status).toBe(200);
 return {ada,eve,root,team,squad,pages};
}
