/**
 * THE PAGES A MEMBER CAN OPEN THROUGH A GROUP, and TRUSTED EMBEDDERS, through the real routes and the app server:
 * `GET /api/groups/:id/artifacts` answers the person asking (here their bearer, as another service holding their
 * token for this API calls it): a direct member sees what the group or a parent owns or is shared with, never a
 * link-only page; a non-member and a deleted group get nothing. `EMBED__TRUSTED_ORIGINS` lets exactly those origins
 * frame a document's address (its `/a/<id>` app page and the document on its own origin) and nothing else of the
 * app, and the embedded view (`?embed=1`) ONLY them.
 */
import {Hono} from 'hono';
import {afterAll,beforeEach,describe,expect,it} from 'vitest';
import {attachActor} from '@artifactbin/utils';
import type {Actor,GroupArtifact} from '@artifactbin/contracts';
import {mountRoutes} from '../server/api';
import {createAppServer} from '../server/app';
import {identityForUser} from '@/lib/accounts';
import {setArtifactGroupShare} from '@/lib/artifacts';
import {createGroup,deleteGroup} from '@/lib/groups';
import {pagesSite} from '@/lib/http';
import {embedTrustedOrigins,setServices} from '@/lib/platform';
import {overrideConfig} from '@/lib/platform/config';
import {admitGroupMember,mintAccountToken,useAppHarness} from './harness';

const harness=useAppHarness();
const app=new Hono();
mountRoutes(app);
const EMBEDDER='https://embedder.example.test';
afterAll(()=>{overrideConfig({},{EMBED__TRUSTED_ORIGINS:undefined});});
// The document's own origin admits the reader's browser session (its pages ticket); every `sess_<user>` is live here.
beforeEach(()=>setServices({humanSessions:{live:async(id,user)=>id===`sess_${user}`}}));

const pagesOf=async(who:{token:string},group:string)=>{
 const r=await app.request(`/api/groups/${encodeURIComponent(group)}/artifacts`,{headers:{authorization:`Bearer ${who.token}`}});
 return {status:r.status,headers:r.headers,body:await r.json() as {artifacts:GroupArtifact[];error?:string}};
};
const ids=(r:{body:{artifacts:GroupArtifact[]}})=>r.body.artifacts.map(a=>a.id).sort();

describe('the pages a member can open through a group',()=>{
 const world=harness.shared(async()=>{
  const alice=await mintAccountToken('ga_alice'),bob=await mintAccountToken('ga_bob'),rita=await mintAccountToken('ga_rita'),carol=await mintAccountToken('ga_carol'),loner=await mintAccountToken('ga_loner');
  const finance=await createGroup(alice.userId!,{handle:'ga_finance',name:'Finance'});
  const retail=await createGroup(alice.userId!,{handle:'ga_retail',name:'Retail',parent_id:finance.id});
  const sales=await createGroup(carol.userId!,{handle:'ga_sales',name:'Sales'});
  const gone=await createGroup(alice.userId!,{handle:'ga_gone',name:'Gone'});
  await admitGroupMember(alice.userId!,finance.id,bob.userId!,'viewer');
  await admitGroupMember(alice.userId!,retail.id,rita.userId!,'viewer');
  await admitGroupMember(alice.userId!,gone.id,bob.userId!,'viewer');
  const publish=async(who:{token:string},title:string,visibility='private')=>{
   const r=await app.request('/api/artifacts',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${who.token}`},body:JSON.stringify({html:`<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`,visibility,title})});
   expect(r.status,await r.clone().text()).toBe(201);
   return ((await r.json()) as {id:string}).id;
  };
  const shared=await publish(alice,'Finance revenue'),unshared=await publish(alice,'Alice draft'),linkOnly=await publish(alice,'Public note','public');
  const salesPage=await publish(carol,'Sales weekly'),gonePage=await publish(alice,'Gone page');
  const as=(who:{userId:string|null})=>identityForUser(who.userId!,null,`${who.userId}@example.test`);
  await setArtifactGroupShare(as(alice),shared,finance.id,'commenter');
  await setArtifactGroupShare(as(carol),salesPage,sales.id,'viewer');
  await setArtifactGroupShare(as(alice),gonePage,gone.id,'viewer');
  await deleteGroup(alice.userId!,gone.id,'ga_gone');
  return {alice,bob,rita,carol,loner,finance,retail,sales,gone,shared,unshared,linkOnly,salesPage};
 });

 it('a direct member sees what the group owns or is shared with, with names and comment counts; never a link-only page',async()=>{
  const {bob,alice,finance,shared,linkOnly,unshared}=world();
  const r=await pagesOf(bob,finance.id);
  expect(r.status,JSON.stringify(r.body)).toBe(200);
  expect(ids(r)).toEqual([shared]);
  expect(r.body.artifacts[0]).toMatchObject({title:'Finance revenue',shared_with:[{id:finance.id,name:'Finance'}],comments:0,owner:{kind:'user'}});
  expect(JSON.stringify(r.body)).not.toContain('@example.test');
  const own=ids(await pagesOf(alice,finance.id));
  expect(own).toEqual([shared]);
  expect(own,'the owner\'s other pages are not the group\'s').not.toContain(unshared);
  expect(own).not.toContain(linkOnly);
 });

 it("a subgroup member sees the parent's shares",async()=>{
  const {rita,retail,shared}=world();
  expect(ids(await pagesOf(rita,retail.id))).toEqual([shared]);
 });

 it('a non-member and a deleted group get nothing',async()=>{
  const {carol,loner,finance,sales,salesPage,bob,gone,rita}=world();
  expect((await pagesOf(carol,finance.id)).status).toBe(404);
  expect(ids(await pagesOf(carol,sales.id))).toEqual([salesPage]);
  expect((await pagesOf(loner,finance.id)).status).toBe(404);
  expect((await pagesOf(rita,finance.id)).status,'a subgroup member is not a member of the parent').toBe(404);
  expect((await pagesOf(bob,gone.id)).status,'a deleted group grants nothing').toBe(404);
  expect((await app.request(`/api/groups/${finance.id}/artifacts`)).status,'anonymous').toBeGreaterThanOrEqual(401);
 });

 it('trusted embedders may frame a document address (app page and document) and nothing else; its embedded view only them',async()=>{
  const {alice,shared}=world();
  const site=pagesSite();
  const server=createAppServer({indexHtml:async()=>'<!doctype html><html><head></head><body><div id="root"></div></body></html>',pagesSite:site});
  const actor:Actor={credential:'session',sessionId:`sess_${alice.userId}`,userId:alice.userId!,email:`${alice.userId}@example.test`,emailVerified:true};
  const ancestors=(csp:string|null)=>/frame-ancestors ([^;]+)/.exec(csp ?? '')![1]!.split(' ').sort();
  const visit=async(path:string)=>server.request(attachActor(new Request(`${site.app}${path}`,{headers:{accept:'text/html'}}),actor));
  const documentOf=async(page:Response)=>{
   const src=/<iframe data-mx-document-frame="" src="([^"]+)"/.exec(await page.text())![1]!.replaceAll('&amp;','&');
   return server.request(src);
  };
  overrideConfig({},{EMBED__TRUSTED_ORIGINS:undefined});
  const plain=await visit(`/a/${shared}`);
  expect(ancestors(plain.headers.get('content-security-policy'))).toEqual(["'self'"]);
  expect(ancestors((await documentOf(plain)).headers.get('content-security-policy'))).toEqual([site.app]);
  expect(ancestors((await visit(`/a/${shared}?embed=1`)).headers.get('content-security-policy')),'no embedder: no one frames the embedded view').toEqual(["'none'"]);
  overrideConfig({},{EMBED__TRUSTED_ORIGINS:EMBEDDER});
  try{
   const page=await visit(`/a/${shared}`);
   expect(ancestors(page.headers.get('content-security-policy'))).toEqual(["'self'",EMBEDDER].sort());
   expect(ancestors((await documentOf(page)).headers.get('content-security-policy'))).toEqual([site.app,EMBEDDER].sort());
   const embedded=await visit(`/a/${shared}?embed=1`);
   expect(ancestors(embedded.headers.get('content-security-policy')),'the embedded view: the embedders alone').toEqual([EMBEDDER]);
   expect(ancestors((await documentOf(embedded)).headers.get('content-security-policy'))).toEqual([site.app,EMBEDDER].sort());
   for(const other of ['/groups','/account','/','/groups?embed=1'])expect(ancestors((await visit(other)).headers.get('content-security-policy')),other).toEqual(["'self'"]);
  }finally{overrideConfig({},{EMBED__TRUSTED_ORIGINS:undefined});}
 });

 it('refuses a malformed embedder list',()=>{
  for(const bad of ['http://evil.example.com','https://x.example/path','not a url']){
   overrideConfig({},{EMBED__TRUSTED_ORIGINS:bad});
   try{expect(()=>embedTrustedOrigins(),bad).toThrow(/EMBED__TRUSTED_ORIGINS/);}finally{overrideConfig({},{EMBED__TRUSTED_ORIGINS:undefined});}
  }
  overrideConfig({},{EMBED__TRUSTED_ORIGINS:'http://mx.lvh.me:6400, https://a.example.com/'});
  try{expect(embedTrustedOrigins()).toEqual(['http://mx.lvh.me:6400','https://a.example.com']);}finally{overrideConfig({},{EMBED__TRUSTED_ORIGINS:undefined});}
 });
});
