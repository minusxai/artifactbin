/**
 * AN AGENT'S IMAGE OF A PAGE, OR OF ONE CHART OF IT, through the ordinary export with its own sign-in: the skill's
 * `export.mjs ID --format png --element SELECTOR` on the composed host (the real identity host in front of the app).
 * A person's run sign-in (contracts `RUN_SIGN_IN_PATH`) exports as that person; an agent signed in as a group, at
 * member and at editor, exports what a direct member of the group reads, its capture reading the page's data as the
 * group (lib/export read-key), under its own stored image, never another level's, a person's or the anonymous one.
 * A token of a kind this installation no longer issues (an artifact read grant, `arg_`) is no sign-in: 401.
 *
 * The browser is a stand-in that does what the capture page does: load the capture, then read the page's `sql` from
 * an opaque origin with the key on its own address. The picture's width is 1 + the rows that read saw.
 */
import {createHmac,hkdfSync} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {afterEach,beforeEach,expect,it,onTestFinished} from 'vitest';
import {RUN_SIGN_IN_PATH, SERVICE_TOKEN_PATH} from '@artifactbin/contracts/service-audiences';
import {SERVICE_AUTH_HEADER} from '@artifactbin/contracts/routes';
import type {RenderRequest} from '@artifactbin/contracts/browser';
import {createAuthComposedHost} from '@/test/helpers/auth-host';
import {AUTH_SECRET,getDb,setServices,syncIdentitySettings} from '@/lib/platform';
import {overrideConfig} from '@/lib/platform/config';
import {createGroup} from '@/lib/groups';
import type {AccessActor} from '@/lib/accounts';
import {exportKeyReader,resetExportRenderer} from '@/lib/export';
import {GET as serveRaw} from '@/app/a/[id]/raw/route';
import {POST as sqlDoor} from '@/app/api/artifacts/[id]/sql/route';
import {tempDir} from '@artifactbin/test-support/temp-dir';
import {admitGroupMember,params,request,useAppHarness} from './harness';
import {runtime,STAFF} from './export-helpers';
import {delegatedService,otpSignIn,serviceAudiences} from '../../auth/__tests__/helpers';
import {exportCommand} from '../skills/artifactbin/scripts/export.mjs';
useAppHarness();

const SECRET='agent-export-test-service-secret',origin='http://localhost:3000';
const WAREHOUSE='http://warehouse.localhost:7444',WAREHOUSE_SECRET='warehouse-introspection-secret';
const AUDIENCES=serviceAudiences({...delegatedService('warehouse',WAREHOUSE,WAREHOUSE_SECRET),run_sign_ins:true});
const QUERY='select name, team from staff order by name';
let directory='';
/** Each capture the stand-in browser drew: what it was asked to draw, whom its key reads as, and how many rows it saw. */
const captures:{capture:RenderRequest['capture'];reader:AccessActor|null;rows:number;key:string}[]=[];
const picture=(width:number)=>sharp({create:{width,height:1,channels:3,background:'#000'}}).png().toBuffer();
beforeEach(async()=>{
 overrideConfig({internalServiceSecret:SECRET,publicBaseUrl:origin},{IDENTITY__SERVICE_AUDIENCES:AUDIENCES});
 await syncIdentitySettings(await getDb());
 directory=await tempDir('agent-export-',onTestFinished);
 captures.length=0;
 await resetExportRenderer();
 setServices({browser:{render:async asked=>{
  const url=new URL(asked.url),id=url.pathname.split('/')[2]!,key=url.searchParams.get('key')!;
  const capture=await serveRaw(request(`${url.pathname}${url.search}`),params(id));
  expect(capture.status).toBe(200);
  const read=await sqlDoor(request(`/api/artifacts/${id}/sql`,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8',origin:'null'},
   body:JSON.stringify({sql:QUERY,params:{},readOnly:true,revision:runtime(await capture.text()).revision,key})}),params(id));
  const rows=((await read.json()) as {rows?:unknown[]}).rows??[];
  captures.push({capture:asked.capture,reader:exportKeyReader(id,key),rows:rows.length,key:url.searchParams.get('key')!});
  return {ok:true,mime:'image/png',bytes:await picture(1+rows.length),...(typeof asked.capture==='object'&&'element' in asked.capture?{element:true}:{})};
 }}});
});
afterEach(async()=>{await resetExportRenderer();setServices({});});

async function composed(){
 const application=await createAuthComposedHost({APP__PUBLIC_BASE_URL:origin,AUTH__SECRET:AUTH_SECRET,INTERNAL__SERVICE_SECRET:SECRET,IDENTITY__SERVICE_AUDIENCES:AUDIENCES,EMAIL__DEV_OUTBOX_PATH:join(directory,'outbox.jsonl')});
 const fetch=(input:Request)=>application.fetch(input);
 const post=(path:string,body:unknown,headers:Record<string,string>={})=>fetch(new Request(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
 const call=async(method:string,path:string,token:string,body?:unknown)=>{
  const response=await fetch(new Request(origin+path,{method,headers:{authorization:`Bearer ${token}`,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return {status:response.status,body:await response.json().catch(()=>null) as Record<string,unknown>|null};
 };
 const signIn=async(email:string)=>{
  const {login,cookie}=await otpSignIn(post,email,async()=>(await readFile(join(directory,'outbox.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(message=>message.to===email).at(-1).otp,{prefix:'/api/auth'});
  expect(login.status).toBe(200);
  const grant=await (await post('/api/authentication/token',{},{cookie})).json() as {access_token:string};
  const userId=((await (await getDb()).query<{id:string}>('SELECT id FROM users WHERE email=$1',[email])).rows[0])!.id;
  const asGroup=async(group:string,role:'member'|'editor')=>(await (await post('/api/authentication/token',{group_id:group,group_role:role},{cookie})).json() as {access_token:string}).access_token;
  /** A run sign-in for this person, as the warehouse service mints one from the person's exchanged token. */
  const runSignIn=async()=>{
   const exchanged=await (await post(SERVICE_TOKEN_PATH,{audience:'warehouse'},{authorization:`Bearer ${grant.access_token}`})).json() as {access_token:string};
   const minted=await post(RUN_SIGN_IN_PATH,{token:exchanged.access_token},{[SERVICE_AUTH_HEADER]:WAREHOUSE_SECRET});
   expect(minted.status).toBe(200);
   return (await minted.json() as {access_token:string}).access_token;
  };
  return {token:grant.access_token,userId,asGroup,runSignIn};
 };
 /** The skill's export, run with this sign-in alone (`ARTIFACTBIN_TOKEN`): the image's width, or the refusal's code. */
 const skillExport=async(token:string,id:string,element?:string)=>{
  const output=join(directory,`${Math.random().toString(36).slice(2)}.png`);
  const env={ARTIFACTBIN_HOME:join(directory,'home'),ARTIFACTBIN_URL:origin,ARTIFACTBIN_TOKEN:token};
  try{
   const done=await exportCommand({values:{format:'png',output,...(element?{element}:{})},positionals:[id]},{env,fetcher:async(url:RequestInfo|URL,init?:RequestInit)=>fetch(new Request(url,init))}) as unknown as {width:number};
   return {width:done.width};
  }catch(error){return {refused:(error as {code?:string}).code};}
 };
 return {fetch,call,signIn,skillExport};
}

/** Root > Team > Squad; Eve edits Team. Team's private page reads Team's private STAFF; Squad has a page of its own. */
async function world(host:Awaited<ReturnType<typeof composed>>){
 const ada=await host.signIn('mxmx_test_ae_ada@example.test'),eve=await host.signIn('mxmx_test_ae_eve@example.test');
 const root=await createGroup(ada.userId,{handle:'ae_root',name:'Root'});
 const team=await createGroup(ada.userId,{handle:'ae_team',name:'Team',parent_id:root.id});
 const squad=await createGroup(ada.userId,{handle:'ae_squad',name:'Squad',parent_id:team.id});
 await admitGroupMember(ada.userId,team.id,eve.userId,'editor');
 const publish=async(token:string,body:Record<string,unknown>)=>{const made=await host.call('POST','/api/artifacts',token,body);expect(made.status,JSON.stringify(made.body)).toBe(201);return String(made.body!.id);};
 const staff=await publish(eve.token,{title:'Staff',dataset:STAFF,visibility:'private',destination:{type:'group',id:team.id}});
 const html=`<html><head><link rel="af-dataset" data-af-name="staff" href="ref:${staff}"></head><body><section id="staff-chart"><af-chart sql="${QUERY}"></af-chart></section></body></html>`;
 const page=await publish(eve.token,{title:'Team staff',html,visibility:'private',destination:{type:'group',id:team.id}});
 const squadPage=await publish(ada.token,{title:'Squad page',html:'<html><body><p id="note">Squad</p></body></html>',visibility:'private',destination:{type:'group',id:squad.id}});
 return {ada,eve,team,page,squadPage};
}

it('a person\'s run sign-in exports one chart of a page as that person, its capture reading their data',async()=>{
 const host=await composed(),{eve,page}=await world(host);
 const run=await eve.runSignIn();
 expect(await host.skillExport(run,page,'#staff-chart')).toEqual({width:1+STAFF.length});
 expect(captures).toHaveLength(1);
 expect(captures[0]).toMatchObject({capture:{element:'#staff-chart'},rows:STAFF.length,reader:{userId:eve.userId}});
 expect(captures[0]!.reader?.principalGroup).toBeUndefined();
 // The whole page too, through the same door.
 expect(await host.skillExport(run,page)).toEqual({width:1+STAFF.length});
});

it('an agent signed in as a group exports one chart of a page its group reads, at member and at editor, read as the group',async()=>{
 const host=await composed(),{eve,team,page,squadPage}=await world(host);
 const keys=new Set<string>();
 for(const role of ['member','editor'] as const){
  captures.length=0;
  const agent=await eve.asGroup(team.id,role);
  expect(await host.skillExport(agent,page,'#staff-chart'),role).toEqual({width:1+STAFF.length});
  expect(captures,role).toHaveLength(1);
  // The capture read as the group at this level: no person, no token, no address.
  expect(captures[0]!.reader,role).toEqual({userId:null,tokenId:null,email:null,documentEditor:false,principalGroup:{id:team.id,role,tokenId:expect.any(String),issuedBy:eve.userId}});
  expect(captures[0]!.rows,role).toBe(STAFF.length);
  // Its stored image is its own: asked again it is served, not drawn again.
  expect(await host.skillExport(agent,page,'#staff-chart'),role).toEqual({width:1+STAFF.length});
  expect(captures,role).toHaveLength(1);
  // The API twin of the door admits it too, and answers the same stored image.
  const api=await host.fetch(new Request(`${origin}/api/artifacts/${page}/export?format=png&element=%23staff-chart`,{headers:{authorization:`Bearer ${agent}`}}));
  expect([api.status,api.headers.get('content-type')],role).toEqual([200,'image/png']);
  expect(captures,role).toHaveLength(1);
  // A page of a subgroup is never its group's to read, nor its image.
  expect(await host.skillExport(agent,squadPage,'#note'),role).toEqual({refused:'not_found'});
  keys.add(role);
 }
 // A person's export of the same chart is drawn again, under the person's own stored image, never the group's.
 captures.length=0;
 expect(await host.skillExport(eve.token,page,'#staff-chart')).toEqual({width:1+STAFF.length});
 expect(captures).toHaveLength(1);
 expect(captures[0]!.reader).toMatchObject({userId:eve.userId});
 expect(keys).toEqual(new Set(['member','editor']));
 // The two levels and the person rendered three images, under three stored keys: none shared.
 const stored=(await (await getDb()).query<{cache_key:string}>('SELECT cache_key FROM export_image_cache WHERE artifact_id=$1',[page])).rows.map(row=>row.cache_key);
 expect(new Set(stored).size).toBe(stored.length);
 expect(stored.filter(key=>key.includes('-a'))).toHaveLength(3);
});

it('refuses a token of a kind this installation no longer issues as no sign-in at all',async()=>{
 const host=await composed(),{page}=await world(host);
 // An artifact read grant as it was signed (`arg_`, its own key): correctly signed, still no bearer anywhere.
 const key=Buffer.from(hkdfSync('sha256',Buffer.from(AUTH_SECRET,'utf8'),Buffer.from('identity-artifact-read-grant'),Buffer.from('v1'),32));
 const now=Math.floor(Date.now()/1000),claims=Buffer.from(JSON.stringify({sub:'usr_bob',aud:WAREHOUSE,svc:'warehouse',iat:now,exp:now+3600,jti:'vtk_1',par:{kind:'token',id:'tok_1'}})).toString('base64url');
 const grant=`arg_${claims}.${createHmac('sha256',key).update('arg_'+claims).digest('base64url')}`;
 const ask=async(path:string)=>(await host.fetch(new Request(origin+path,{headers:{authorization:`Bearer ${grant}`}}))).status;
 for(const path of ['/api/artifacts',`/api/artifacts/${page}`,`/api/artifacts/${page}/export?format=png&element=%23staff-chart`])expect(await ask(path),path).toBe(401);
 // The reader's export door takes it for no credential: the private page is the uniform 404, and nothing is drawn.
 expect(await ask(`/a/${page}/export?format=png&element=%23staff-chart`)).toBe(404);
 expect(captures).toEqual([]);
});
