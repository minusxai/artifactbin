/**
 * A SIGNED-IN AUTHOR'S DRAFT CHECK (POST /api/page/drafts/check, lib/page-drafts draftCheckAnswer) on the composed host,
 * with the browser's `inspect` stood in: a person (bearer, session or run sign-in) and an agent signed in as a group at
 * either level get the trusted relay's answer for its exact body; the draft is shown to the browser as the relay's is,
 * plus overflow; size, shape, hourly and running bounds refuse by name; a guest, a test user, a bare token and nobody
 * are refused before anything is made. The real-Chromium half is lib/page-drafts/__tests__/check-sign-in-browser.test.ts.
 */
import {afterEach,beforeEach,expect,it,onTestFinished} from 'vitest';
import {EXPORT_INTERNAL_ORIGIN,getDb,services,setServices} from '@/lib/platform';
import { syncIdentitySettings } from '@/lib/platform/testing';
import {overrideConfig} from '@/lib/platform/config';
import {pagesSite} from '@/lib/http';
import {setDraftCheckCapForTests} from '@/lib/allowances';
import {createTestUser,identityForUser} from '@/lib/accounts';
import {RUN_SIGN_IN_PATH, SERVICE_TOKEN_PATH} from '@artifactbin/contracts/service-audiences';
import {SERVICE_AUTH_HEADER} from '@artifactbin/contracts/routes';
import {SERVICE_PAYLOAD_LIMIT} from '@artifactbin/contracts/payload-limit';
import type {PageInspectRequest, PageInspection, PageProblem} from '@artifactbin/contracts/browser';
import {POST} from '@/app/api/page/drafts/check/route';
import {createGuestOwner,mintAccountToken,request,useAppHarness} from './harness';
import {SECRET,composed,origin,useGroupPrincipalHost,world} from './group-principal-fixture';
import {delegatedService,serviceAudiences} from '../../auth/__tests__/helpers';
import {mintToken} from '@/lib/accounts/tokens';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tempDir} from '@artifactbin/test-support/temp-dir';
import {syntheticEnv} from '@/test/helpers/toolbox-env';
import {checkCommand} from '../skills/artifactbin/scripts/check.mjs';
import {checkDigest} from '../skills/artifactbin/scripts/toolbox-client.mjs';
useAppHarness();
useGroupPrincipalHost();
const SERVICE_SECRET='draft-check-run-sign-in-secret',AUDIENCES=serviceAudiences({...delegatedService('warehouse','http://warehouse.localhost:7444',SERVICE_SECRET),run_sign_ins:true});
beforeEach(async()=>{overrideConfig({internalServiceSecret:SECRET,publicBaseUrl:origin},{IDENTITY__SERVICE_AUDIENCES:AUDIENCES});await syncIdentitySettings(await getDb());});
const original=services().browser;
afterEach(()=>setServices({browser:original}));

const b64=(text:string)=>Buffer.from(text).toString('base64');
const DRAFT={html:'<!doctype html><html><head><link rel="af-dataset" data-af-name="data" href="./data.csv"></head><body><h1>Draft</h1><div style="width:3000px">wide</div></body></html>',entryPath:'reports/draft.html',files:[{path:'reports/data.csv',base64:b64('a\n1\n'),contentType:'text/csv'}]};
const PROBLEMS:PageProblem[]=[{kind:'console',message:'total is not defined'},{kind:'overflow',element:'div',message:'the page is 1720px wider than its 1280px window: div sticks out'}];
const IMAGE={mime:'image/jpeg' as const,width:1280,height:800,bytes:3,data:'AAAA'};
/** The browser stood in: each request it was asked, and the draft's own file as the browser fetched it while it looked. */
function stand(hold?:Promise<void>,problems:PageProblem[]=PROBLEMS){
 const asked:PageInspectRequest[]=[],files:number[]=[];
 setServices({browser:{...original,inspect:async(request):Promise<PageInspection>=>{
  asked.push(request);const url=new URL(request.url);
  const {createAppServer}=await import('@/server/app');
  files.push((await createAppServer({indexHtml:async()=>'<html></html>',pagesSite:pagesSite()}).request(`${url.origin}/reports/data.csv`,{headers:{host:url.host}})).status);
  await hold;
  return {ok:true,truncated:false,image:IMAGE,problems};
 }}});
 return {asked,files};
}

async function people(){
 const host=await composed({IDENTITY__SERVICE_AUDIENCES:AUDIENCES}),{eve,team}=await world(host,false);
 const check=async(token:string,body:unknown=DRAFT)=>host.call('POST','/api/page/drafts/check',token,body);
 return {host,eve,team,check};
}

it('a person (bearer, session, run sign-in) and a group agent at either level get the relay\'s answer for its exact body, checked as no one',async()=>{
 const {host,eve,team,check}=await people();
 const {asked,files}=stand();
 const member=await eve.asGroup(team.id,'member'),editor=await eve.asGroup(team.id,'editor');
 // A run sign-in: the person's exchanged token, turned into an ordinary sign-in by the service that opted in.
 const exchanged=await (await host.fetch(new Request(origin+SERVICE_TOKEN_PATH,{method:'POST',headers:{authorization:`Bearer ${eve.token}`,'content-type':'application/json'},body:JSON.stringify({audience:'warehouse'})}))).json() as {access_token:string};
 const run=await (await host.fetch(new Request(origin+RUN_SIGN_IN_PATH,{method:'POST',headers:{[SERVICE_AUTH_HEADER]:SERVICE_SECRET,'content-type':'application/json'},body:JSON.stringify({token:exchanged.access_token,expires_in:600})}))).json() as {access_token:string};
 for(const [who,token] of [['bearer',eve.token],['run sign-in',run.access_token],['group member',member.token],['group editor',editor.token]] as const){
  const answered=await check(token);
  expect(answered,who).toEqual({status:200,body:{problems:PROBLEMS,truncated:false,image:IMAGE}});
 }
 // The person's own browser session, same-site.
 const session=await host.fetch(new Request(origin+'/api/page/drafts/check',{method:'POST',headers:{cookie:eve.cookie,origin,'content-type':'application/json'},body:JSON.stringify(DRAFT)}));
 expect(session.status).toBe(200);expect(session.headers.get('cache-control')).toBe('no-store');
 // A cookie from another site is refused before anything is made.
 expect((await host.fetch(new Request(origin+'/api/page/drafts/check',{method:'POST',headers:{cookie:eve.cookie,origin:'https://elsewhere.example','content-type':'application/json'},body:JSON.stringify(DRAFT)}))).status).toBe(403);
 expect(asked).toHaveLength(5);
 const site=pagesSite();
 for(const request of asked){
  // The relay's own request (lib/page-drafts checkDraft), with overflow said too: under the draft's origin, fetched from this process.
  expect(request).toMatchObject({internalOrigin:EXPORT_INTERNAL_ORIGIN,sameOriginOnly:true,allowedOrigins:[site.app],selector:'body',screenshot:true,overflow:true,viewport:{width:1280,height:800}});
  const url=new URL(request.url);
  expect(url.hostname).toMatch(new RegExp(`^draft-[a-z2-7]{26}\\.${site.host.replaceAll('.','\\.')}$`));
  expect(url.pathname).toBe('/reports/draft.html');
  // Nothing of the caller rides along: no header, no cookie, no token in what the browser is asked to load.
  for(const secret of [eve.token,run.access_token,member.token,editor.token,eve.cookie])expect(JSON.stringify(request)).not.toContain(secret);
 }
 // The draft was live while it was looked at, and every check made its own.
 expect(files).toEqual([200,200,200,200,200]);
 expect(new Set(asked.map(request=>new URL(request.url).hostname)).size).toBe(5);
});

it('refuses by name what is too large, malformed or not a draft, before the browser is asked',async()=>{
 const {eve,check}=await people();
 const {asked}=stand();
 const big=await check(eve.token,{...DRAFT,html:'x'.repeat(SERVICE_PAYLOAD_LIMIT)});
 expect(big).toEqual({status:413,body:{error:'too_large',max:SERVICE_PAYLOAD_LIMIT,message:expect.any(String)}});
 for(const body of [{html:DRAFT.html},{files:[]},{...DRAFT,liveSql:true},{...DRAFT,title:'x'},[DRAFT]]){
  expect(await check(eve.token,body),JSON.stringify(body).slice(0,80)).toEqual({status:400,body:{error:'bad_request',message:'send {html, entryPath?, files}'}});
 }
 const missing=await check(eve.token,{html:'<img src="./gone.png">',files:[]});
 expect(missing).toEqual({status:400,body:{error:'unresolved_draft_files',message:expect.stringContaining('gone.png')}});
 expect(asked).toHaveLength(0);
});

it('counts a person\'s checks an hour however they sign in, and a group\'s by the group and each member\'s share of it',async()=>{
 const {host,eve,team,check}=await people();
 const ada=await host.signIn('mxmx_test_ga_ada@example.test');
 const asked=stand().asked;setDraftCheckCapForTests(3);onTestFinished(()=>setDraftCheckCapForTests(null));
 const spent={status:429,body:{error:'rate_limited',message:'At most 3 draft checks an hour (and 15 s of browser time) for you, whichever way you sign in, and a group\'s own share; try again later.'}};
 const member=await eve.asGroup(team.id,'member'),editor=await eve.asGroup(team.id,'editor');
 // Eve's own checks and her group agents' are one person's hour (3); her share of the group (2) is spent first.
 expect((await check(eve.token)).status).toBe(200);
 expect((await check(member.token)).status).toBe(200);expect((await check(editor.token)).status).toBe(200);
 expect(await check(member.token)).toEqual(spent);
 expect(await check(eve.token)).toEqual(spent);
 // Another member's share of the same group is their own; the group's hour (6) is shared by both.
 const adaMember=await ada.asGroup(team.id,'member'),adaEditor=await ada.asGroup(team.id,'editor');
 expect((await check(adaMember.token)).status).toBe(200);expect((await check(adaEditor.token)).status).toBe(200);
 expect(await check(adaMember.token)).toEqual(spent);
 // Each check names every key it spends from to the browser service, which counts them for every app process.
 expect(asked.map(request=>request.charge?.map(charge=>charge.key))).toEqual([
  [`person:${eve.userId}`],
  [`person:${eve.userId}`,`group:${team.id}`,`group:${team.id}:by:${eve.userId}`],
  [`person:${eve.userId}`,`group:${team.id}`,`group:${team.id}:by:${eve.userId}`],
  [`person:${ada.userId}`,`group:${team.id}`,`group:${team.id}:by:${ada.userId}`],
  [`person:${ada.userId}`,`group:${team.id}`,`group:${team.id}:by:${ada.userId}`],
 ]);
 expect(asked[1]!.charge).toEqual([{key:`person:${eve.userId}`,perHour:3,msPerHour:15_000},{key:`group:${team.id}`,perHour:6,msPerHour:30_000},{key:`group:${team.id}:by:${eve.userId}`,perHour:2,msPerHour:10_000}]);
});

it('runs one check per person (whichever way they sign in) and per group, two in all at once, answering browser_busy past any',async()=>{
 const {host,eve,team,check}=await people();
 const ada=await host.signIn('mxmx_test_ga_ada@example.test');
 let open!:()=>void;const hold=new Promise<void>(resolve=>{open=resolve;});
 const {asked}=stand(hold);
 const member=await eve.asGroup(team.id,'member'),adaMember=await ada.asGroup(team.id,'member');
 const busy={status:429,body:{error:'browser_busy',message:'At most 1 of your draft checks and 2 in all run at once; check again when yours finishes.'}};
 const first=check(eve.token);
 while(asked.length<1)await new Promise(resolve=>setTimeout(resolve,5));
 // Eve signed in as her group is still Eve.
 expect(await check(eve.token)).toEqual(busy);expect(await check(member.token)).toEqual(busy);
 const second=check(adaMember.token);
 while(asked.length<2)await new Promise(resolve=>setTimeout(resolve,5));
 // The group has a check running (Ada's), and two run in all.
 expect(await check(ada.token)).toEqual(busy);
 open();
 expect((await first).status).toBe(200);expect((await second).status).toBe(200);
 // A busy refusal spent no hour; a finished check frees its slot.
 expect((await check(member.token)).status).toBe(200);
 expect((await check(ada.token)).status).toBe(200);
});

it('answers the browser service\'s own refusals (for every app process) as this route\'s, and the relay\'s as a browser that could not look',async()=>{
 const {eve,check}=await people();
 setDraftCheckCapForTests(2);onTestFinished(()=>setDraftCheckCapForTests(null));
 for(const [reason,error] of [['busy','browser_busy'],['rate_limited','rate_limited']] as const){
  setServices({browser:{...original,inspect:async():Promise<PageInspection>=>({ok:false,reason})}});
  expect(await check(eve.token)).toMatchObject({status:429,body:{error}});
 }
 // The busy refusal spent none of this hour (2): the one rate_limited answer did, so one check is left.
 stand();
 expect((await check(eve.token)).status).toBe(200);
 expect((await check(eve.token)).body).toMatchObject({error:'rate_limited'});
 setServices({browser:{...original,inspect:async():Promise<PageInspection>=>({ok:false,reason:'busy'})}});
 const {draftCheckAnswer}=await import('@/lib/page-drafts');
 expect(await draftCheckAnswer(DRAFT)).toEqual({status:503,body:{error:'check_unavailable'}});
});

it('refuses a guest, a test user, a bare token and nobody, making nothing',async()=>{
 const {asked}=stand();
 const person=await mintAccountToken('draft-check-person');
 const testuser=await createTestUser(identityForUser(person.userId,person.id));
 if(!testuser.ok)throw Error(testuser.error);
 const guest=await createGuestOwner();
 const guestToken=await mintToken('guest-agent',guest.userId);
 const bare=await mintAccountToken('bare',null);
 const call=(token?:string)=>POST(request('/api/page/drafts/check',{method:'POST',json:DRAFT,...(token?{token}:{})}));
 const refusal={error:'account_required',message:'Sign in with an account to check a draft.'};
 const answered=await call(testuser.token);
 expect([answered.status,await answered.json()]).toEqual([403,refusal]);
 // A guest's credential and a token with no account sign in nowhere: the uniform 401, as for nobody.
 for(const token of [guestToken.token,bare.token,undefined])expect((await call(token)).status).toBe(401);
 expect((await call(person.token)).status).toBe(200);
 expect(asked).toHaveLength(1);
});

it('the skill checks an unpublished file in the server\'s browser (check.mjs FILE.html --draft), waiting out a busy one',async()=>{
 const {host,eve,check}=await people();
 const root=await tempDir('draft-check-skill-',onTestFinished),site=path.join(root,'site');await mkdir(site);
 const file=path.join(site,'index.html'),html='<!doctype html><html><head><link rel="af-dataset" data-af-name="data" href="./data.csv"></head><body><h1>Draft</h1></body></html>';
 await writeFile(file,html);await writeFile(path.join(site,'data.csv'),'a\n1\n');
 const sent:Array<{url:string;body:unknown}>=[];
 const options={env:syntheticEnv(origin,root,{token:eve.token}),busyDelayMs:20,fetcher:async(input:string,init:RequestInit)=>{
  sent.push({url:String(input),body:init?.body?JSON.parse(String(init.body)):undefined});return host.fetch(new Request(input,init));}};
 // Problems: a failed check naming each one, its picture saved as a JPEG beside the other checks.
 let {asked}=stand();
 const failed=await checkCommand({values:{draft:true},positionals:[file]},options).catch((error:any)=>error);
 expect(failed).toMatchObject({code:'check_failed',exit:1,details:{draft:true,smokePassed:false,problems:PROBLEMS,truncated:false,screenshot:{path:expect.stringMatching(/\.jpg$/)}}});
 expect(await readFile(failed.details.screenshot.path)).toEqual(Buffer.from(IMAGE.data,'base64'));
 // The relay's exact body: the page, its path and the file it links.
 expect(sent.map(({url,body})=>[url,body])).toEqual([[`${origin}/api/page/drafts/check`,{html,entryPath:'index.html',files:[{path:'data.csv',contentType:'text/csv',base64:Buffer.from('a\n1\n').toString('base64')}]}]]);
 expect(asked).toHaveLength(1);
 const digest=checkDigest({...failed.details,ok:false,code:'check_failed'});
 expect(digest).toContain('  console: total is not defined\n  overflow div: the page is 1720px wider');
 expect(digest).toContain(`  screenshot: ${failed.details.screenshot.path}`);
 // Clean, while another check of the same author holds the browser: refused browser_busy, waited for, then checked.
 let open!:()=>void;const hold=new Promise<void>(resolve=>{open=resolve;});
 ({asked}=stand(hold,[]));sent.length=0;
 const holding=check(eve.token);
 while(asked.length<1)await new Promise(resolve=>setTimeout(resolve,5));
 const clean=checkCommand({values:{draft:true},positionals:[file]},options);
 while(sent.length<2)await new Promise(resolve=>setTimeout(resolve,5));
 open();
 expect(await clean).toMatchObject({draft:true,smokePassed:true,problems:[],screenshot:{path:expect.stringMatching(/\.jpg$/)}});
 expect((await holding).status).toBe(200);
 expect(checkDigest({ok:true,code:'completed',...await clean})).toContain('check completed: smoke passed');
 // A draft is checked once, with no steps or other viewers; a URL is not a draft.
 for(const values of [{draft:true,steps:'s.mjs'},{draft:true,viewport:['800x600']},{draft:true,viewer:'guest'}])
  await expect(checkCommand({values,positionals:[file]},options)).rejects.toMatchObject({code:'draft_options',exit:2});
 await expect(checkCommand({values:{draft:true},positionals:['https://example.test/a/PAGE12']},options)).rejects.toMatchObject({code:'draft_options',exit:2});
});
