/**
 * THE DOOR TABLE, pinned through real routes: which credential each door admits, and what it does with
 * it. Every identity in the app is resolved once per request (lib/authentication request-identity); the doors
 * only choose a policy. These cases hold that policy still while the resolver underneath changes.
 *
 *  - token door   `withTokenAuth`          GET /api/artifacts, POST /api/artifacts/preflight, GET /api/artifacts/:id
 *  - request door `requestOrSessionActor`  GET /a/:id/raw, GET /api/remote/sessions
 *  - session door `sessionActor`           GET /api/page/session
 */
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import type {Actor} from '@artifactbin/contracts';
import {BROWSER_SESSION_HEADER} from '@artifactbin/contracts';
import {nativeHtml} from './native-html-fixture';
import { setDocumentEditorPolicy } from '@/lib/authentication';
import {GET as list} from '@/app/api/artifacts/route';
import {GET as read} from '@/app/api/artifacts/[id]/route';
import {GET as raw} from '@/app/a/[id]/raw/route';
import {GET as pageSession} from '@/app/api/page/session/route';
import {createGuestOwner,mintAccountToken,request,setSession,useAppHarness} from './harness';
import { sessionActor } from '@/lib/authentication';

const harness=useAppHarness();
const verified=(userId:string,email:string,extra:Partial<Actor>={}):Actor=>({credential:'session',userId,email,emailVerified:true,...extra});
/** A request carrying BOTH an Authorization header and a proxy-attached actor (the harness refuses to build one). */
const both=(path:string,bearer:string,actor:Actor,init:{method?:string;headers?:Record<string,string>}={})=>{
 const built=request(path,{actor,...init});built.headers.set('authorization',`Bearer ${bearer}`);return built;
};
const ctx=(params:{id:string})=>({params:Promise.resolve(params)});
const lastUsed=async(id:string)=>(await (await harness.db()).query<{last_used_at:string|null;client_harness:string|null}>('SELECT last_used_at,client_harness FROM tokens WHERE id=$1',[id])).rows[0]!;
const INVALID='mx_'+'x'.repeat(43);

let a:Awaited<ReturnType<typeof mintAccountToken>>,b:Awaited<ReturnType<typeof mintAccountToken>>;
beforeEach(async()=>{
 a=await mintAccountToken('mxmx_test_door_a');b=await mintAccountToken('mxmx_test_door_b');
 // One private document of A's, read through the request door to say whose identity a request carried.
 await (await harness.db()).query(`INSERT INTO artifacts(id,token_id,user_id,title,source,meta,format,visibility,edit_id) VALUES ('door01',$1,$2,'A private',$3,'{}','html','private','door-edit')`,[a.id,a.userId,nativeHtml('<p id="intro">Only A</p>')]);
});
afterEach(()=>{setDocumentEditorPolicy();setSession(null);});

describe('an explicit bearer',()=>{
 it('that does not resolve is refused at every door and never falls back to the cookie identity',async()=>{
  const session=verified(a.userId!,a.email!);
  expect((await list(both('/api/artifacts',INVALID,session))).status).toBe(401);
  expect((await raw(request('/a/door01/raw',{actor:session}),ctx({id:'door01'}))).status).toBe(200);
  expect((await raw(both('/a/door01/raw',INVALID,session),ctx({id:'door01'}))).status).toBe(404);
  // A direct-mode session (no proxy) is a cookie too: an invalid bearer still does not fall back to it.
  setSession({user:{id:a.userId!,email:a.email}});
  expect((await list(request('/api/artifacts',{token:INVALID}))).status).toBe(401);
  expect((await raw(request('/a/door01/raw',{token:INVALID}),ctx({id:'door01'}))).status).toBe(404);
 });
 it('beats the cookie when both are present',async()=>{
  const listed=await list(both('/api/artifacts',a.token,verified(b.userId!,b.email!)));
  expect(listed.status).toBe(200);expect(listed.headers.get('X-Artifactbin-Account')).toBe(a.userId);
  expect((await raw(both('/a/door01/raw',a.token,verified(b.userId!,b.email!)),ctx({id:'door01'}))).status).toBe(200);
  expect((await raw(both('/a/door01/raw',b.token,verified(a.userId!,a.email!)),ctx({id:'door01'}))).status).toBe(404);
 });
});

describe('a session cookie alone',()=>{
 it('is 401 on the token door and accepted on the request and session doors',async()=>{
  const actor=verified(a.userId!,a.email!);
  expect((await list(request('/api/artifacts',{actor}))).status).toBe(401);
  expect((await raw(request('/a/door01/raw',{actor}),ctx({id:'door01'}))).status).toBe(200);
  expect(await (await pageSession(request('/api/page/session',{actor}))).json()).toMatchObject({user:{id:a.userId},kind:'account'});
 });
});

describe('the token door protocol',()=>{
 it('pins the account while ignoring retired CLI version headers',async()=>{
  const ok=await list(request('/api/artifacts',{token:a.token}));
  expect(ok.headers.get('X-Artifactbin-Account')).toBe(a.userId);
  for(const name of ['X-Artifactbin-Protocol','X-Artifactbin-CLI-Version'])expect(ok.headers.get(name)).toBeNull();
  const mismatch=await list(request('/api/artifacts',{token:a.token,headers:{'X-Artifactbin-Account':b.userId!}}));
  expect(mismatch.status).toBe(409);expect(await mismatch.json()).toMatchObject({error:'account_mismatch',actual_account:a.userId});
  const legacy=await list(request('/api/artifacts',{token:a.token,headers:{'X-Artifactbin-Protocol':'0','User-Agent':'afbin/0.0.1'}}));
  expect(legacy.status).toBe(200);expect(legacy.headers.get('X-Artifactbin-Protocol')).toBeNull();
 });
});

describe('dry runs',()=>{
 it('leave no trace on the token door, and are deliberately ignored by the request door',async()=>{
  const dry={'X-Artifactbin-Dry-Run':'1','Artifactbin-Agent':'claude-code'};
  expect((await list(request('/api/artifacts',{token:a.token,headers:dry}))).status).toBe(200);
  expect(await lastUsed(a.id)).toEqual({last_used_at:null,client_harness:null});
  expect((await list(request('/api/artifacts',{token:a.token,headers:{'Artifactbin-Agent':'claude-code'}}))).status).toBe(200);
  expect(await lastUsed(a.id)).toMatchObject({last_used_at:expect.anything(),client_harness:'claude-code'});
  expect((await raw(request('/a/door01/raw',{token:b.token,headers:dry}),ctx({id:'door01'}))).status).toBe(404);
  expect((await lastUsed(b.id)).last_used_at).not.toBeNull();
 });
});

describe('the browser-session header',()=>{
 it('suppresses the verified-email claim, so a host grant never reaches a scripted browser',async()=>{
  const db=await harness.db();
  await db.query(`INSERT INTO artifacts(id,token_id,user_id,title,source,meta,format,visibility,edit_id) VALUES ('door02',$1,$2,'B unlisted',$3,'{}','html','unlisted','door-edit')`,[b.id,b.userId,nativeHtml('<p id="intro">B</p>')]);
  setDocumentEditorPolicy(account=>account.userId===a.userId&&account.emailVerified===true);
  const claims:Actor={credential:'bearer',userId:a.userId!,tokenId:a.id,email:a.email!,emailVerified:true};
  const edit=async(headers:Record<string,string>={})=>(await (await read(both('/api/artifacts/door02',a.token,claims,{headers}),ctx({id:'door02'}))).json() as {capabilities:{edit:boolean}}).capabilities.edit;
  expect(await edit()).toBe(true);
  expect(await edit({[BROWSER_SESSION_HEADER]:'1'})).toBe(false);
 });
 it('suppresses it for a proxy-attached bearer too: the grant is never decided from a scripted browser',async()=>{
  setDocumentEditorPolicy(account=>account.userId===a.userId&&account.emailVerified===true);
  const claims:Actor={credential:'bearer',userId:a.userId!,tokenId:a.id,email:a.email!,emailVerified:true};
  expect(await sessionActor(request('/a/door01',{actor:claims}))).toMatchObject({credential:'bearer',documentEditor:true});
  expect(await sessionActor(request('/a/door01',{actor:claims,headers:{[BROWSER_SESSION_HEADER]:'1'}}))).toMatchObject({credential:'bearer',emailVerified:null,documentEditor:false});
 });
 it('admits only a live token that belongs to the attached account',async()=>{
  const forged=request('/api/page/session',{actor:{credential:'bearer',userId:a.userId!,tokenId:b.id},headers:{[BROWSER_SESSION_HEADER]:'1'}});
  expect(await (await pageSession(forged)).json()).toMatchObject({user:null,kind:'none'});
 });
});

describe('session side effects',()=>{
 it('accept a pending group invitation only for a verified address',async()=>{
  const db=await harness.db();
  await db.query("INSERT INTO groups(id,handle,name,created_by) VALUES ('gdoor','doorcrew','Door crew',$1)",[b.userId]);
  await db.query("INSERT INTO group_invitations(id,group_id,email,role,invited_by) VALUES ('gin_door','gdoor',$1,'viewer',$2)",[a.email,b.userId]);
  await pageSession(request('/api/page/session',{actor:verified(a.userId!,a.email!,{emailVerified:false})}));
  expect((await db.query("SELECT 1 FROM group_members WHERE group_id='gdoor' AND user_id=$1",[a.userId])).rows).toHaveLength(0);
  await pageSession(request('/api/page/session',{actor:verified(a.userId!,a.email!)}));
  expect((await db.query("SELECT role FROM group_members WHERE group_id='gdoor' AND user_id=$1",[a.userId])).rows).toEqual([{role:'viewer'}]);
 });
 it('adopt held guest ownership only for a verified address',async()=>{
  const guest=await createGuestOwner(),db=await harness.db();
  const held=(emailVerified:boolean)=>pageSession(request('/api/page/session',{actor:verified(a.userId!,a.email!,{emailVerified,heldTokenIds:[guest.tokenId]})}));
  const owner=async()=>(await db.query<{user_id:string}>('SELECT user_id FROM tokens WHERE id=$1',[guest.tokenId])).rows[0]!.user_id;
  await held(false);expect(await owner()).toBe(guest.userId);
  await held(true);expect(await owner()).toBe(a.userId);
 });
});
