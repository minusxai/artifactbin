import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCli} from '../src/dispatch';
import {loadConnection,saveConnection} from '../src/config';
import {browserAuthenticate} from '../src/browser-auth';
import {CliError} from '../src/commands';

const origin='https://example.com';
const s256=(value:string)=>createHash('sha256').update(value).digest('base64url');

/** A fake server speaking both CLI doors, recording what the CLI sent. */
function fakeServer({loopback=true,endpoint=origin+'/oauth/loopback',tokenStatus=200}:{loopback?:boolean;endpoint?:string;tokenStatus?:number}={}){
 const seen={paths:[] as string[],challenge:'',redirect:'',exchanged:undefined as undefined|Record<string,string>};
 const fetch:typeof globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input));seen.paths.push(url.pathname);
  if(url.pathname==='/api/server')return Response.json({origin,aliases:[]});
  if(url.pathname==='/.well-known/oauth-authorization-server')return Response.json({issuer:origin,...(loopback?{cli_loopback_authorization_endpoint:endpoint}:{})});
  if(url.pathname==='/oauth/loopback/token'){
   const body=JSON.parse(String(init?.body)) as Record<string,string>;seen.exchanged=body;
   if(tokenStatus!==200||s256(body.code_verifier!)!==seen.challenge||body.redirect_uri!==seen.redirect||body.code!=='the_code')return Response.json({error:'invalid_grant'},{status:400});
   return Response.json({access_token:'loopback_access',refresh_token:'loopback_refresh',client_id:'afbin_client',token_type:'Bearer',expires_in:3600,scope:'artifacts'});
  }
  if(url.pathname==='/oauth/device')return Response.json({device_code:'d'.repeat(43),user_code:'ABCD',verification_uri_complete:origin+'/oauth/device?user_code=ABCD',expires_in:900,interval:5});
  if(url.pathname==='/oauth/device/token')return Response.json({access_token:'device_access',refresh_token:'device_refresh',client_id:'client',expires_in:3600});
  if(url.pathname==='/api/artifacts')return Response.json({artifacts:[]});
  return new Response('not found',{status:404});
 };
 return {seen,fetch};
}
/** The signed-in browser: the server's page redirects to the CLI's listener; optional stray callbacks first. */
function signedInBrowser(seen:{challenge:string;redirect:string},{strays=[] as Record<string,string>[]}={}){
 const opened:string[]=[];const pages:Promise<{status:number;text:string}>[]=[];
 const open=async(raw:string)=>{
  opened.push(raw);const url=new URL(raw);
  if(url.pathname!=='/oauth/loopback')return;
  seen.challenge=url.searchParams.get('code_challenge')!;seen.redirect=url.searchParams.get('redirect_uri')!;
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  const visit=async(params:Record<string,string>)=>{const target=new URL(seen.redirect);for(const [k,v] of Object.entries(params))target.searchParams.set(k,v);const r=await fetch(target);return {status:r.status,text:await r.text()};};
  pages.push((async()=>{
   for(const stray of strays)pages.push(Promise.resolve(await visit(stray)));
   return visit({code:'the_code',state:url.searchParams.get('state')!});
  })());
 };
 return {open,opened,pages};
}

test('a signed-in local browser completes afbin auth with no click: loopback listener, S256 PKCE, exact redirect, saved like a device grant',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-loopback-ok-'));const output:string[]=[];
 try{
  const {seen,fetch}=fakeServer();const browser=signedInBrowser(seen);
  const code=await runCli(['auth','--server',origin,'--json'],{home,cwd:home,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},auth:{open:browser.open},fetch});
  assert.equal(code,0,output.join(''));
  assert.deepEqual(JSON.parse(output.join('')),{authenticated:true,server:origin});
  assert.equal(browser.opened.length,1);
  assert.match(seen.redirect,/^http:\/\/(127\.0\.0\.1|\[::1\]):\d+\/callback$/);
  assert.equal(seen.exchanged?.redirect_uri,seen.redirect);
  assert.ok(!seen.paths.includes('/oauth/device'),'no device pairing was started');
  const page=await browser.pages[0]!;assert.equal(page.status,200);assert.match(page.text,/Signed in — you can close this tab/);
  const saved=await loadConnection(origin,home,{});
  assert.deepEqual({...saved,expiresAt:undefined},{server:origin,token:'loopback_access',refreshToken:'loopback_refresh',clientId:'afbin_client',expiresAt:undefined});
  assert.ok(saved!.expiresAt!>Date.now());
 }finally{await rm(home,{recursive:true,force:true});}
});

test('a callback with the wrong state is refused and ignored; the command keeps waiting for its own',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-loopback-state-'));
 try{
  const {seen,fetch}=fakeServer();const browser=signedInBrowser(seen,{strays:[{code:'the_code',state:'not-this-command'},{code:'the_code'}]});
  const connection=await browserAuthenticate(origin,{home,env:{},interactive:false,fetch,notify:()=>{},open:browser.open});
  assert.equal(connection.token,'loopback_access');
  const pages=await Promise.all(browser.pages);
  assert.deepEqual(pages.map(page=>page.status).sort(),[200,400,400]);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('--force re-authenticates through the loopback even with a valid saved connection',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-loopback-force-'));const output:string[]=[];
 try{
  await saveConnection({server:origin,token:'saved_access'},home);
  const {seen,fetch}=fakeServer();const browser=signedInBrowser(seen);
  assert.equal(await runCli(['auth','--force','--server',origin,'--json'],{home,cwd:home,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},auth:{open:browser.open},fetch}),0,output.join(''));
  assert.equal((await loadConnection(origin,home,{}))?.token,'loopback_access');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('falls back to the unchanged device page: SSH sessions, servers without the loopback, foreign endpoints, a browser that cannot open, no callback in time',async()=>{
 const cases:{name:string;env?:NodeJS.ProcessEnv;server?:Parameters<typeof fakeServer>[0];open?:'throw'|'ignore';probe:boolean}[]=[
  {name:'ssh',env:{SSH_CONNECTION:'10.0.0.2 5000 10.0.0.1 22'},probe:false},
  {name:'old server',server:{loopback:false},probe:true},
  {name:'foreign endpoint',server:{endpoint:'https://evil.example/oauth/loopback'},probe:true},
  {name:'browser unavailable',open:'throw',probe:true},
  {name:'no callback within the agent wait',open:'ignore',probe:true},
 ];
 for(const item of cases){
  const home=await mkdtemp(join(tmpdir(),'afbin-loopback-fallback-'));
  try{
   const {seen,fetch}=fakeServer(item.server);const opened:string[]=[];let now=Date.now();
   const messages:string[]=[];
   const open=async(url:string)=>{opened.push(url);if(item.open==='throw')throw new Error('no browser');};
   const run=browserAuthenticate(origin,{home,env:item.env??{},interactive:false,fetch,notify:m=>messages.push(m),open,now:()=>now,sleep:async ms=>{now+=ms;}});
   if(item.open==='throw')await assert.rejects(run,(error:unknown)=>error instanceof CliError&&error.code==='browser_unavailable',item.name);
   else assert.equal((await run).token,'device_access',item.name);
   assert.equal(seen.paths.includes('/.well-known/oauth-authorization-server'),item.probe,item.name);
   assert.ok(seen.paths.includes('/oauth/device'),item.name);
   assert.ok(!seen.paths.includes('/oauth/loopback/token'),item.name);
   const device=opened.filter(url=>new URL(url).pathname==='/oauth/device');
   assert.equal(device.length,1,item.name);
   assert.ok(messages.some(message=>/Approve code ABCD/.test(message)),item.name);
   if(item.name==='no callback within the agent wait'){assert.equal(opened.length,2);assert.equal(new URL(opened[0]!).pathname,'/oauth/loopback');}
  }finally{await rm(home,{recursive:true,force:true});}
 }
});

test('a refused code exchange saves nothing and tells the browser to retry',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-loopback-refused-'));
 try{
  const {seen,fetch}=fakeServer({tokenStatus:400});const browser=signedInBrowser(seen);
  await assert.rejects(browserAuthenticate(origin,{home,env:{},interactive:false,fetch,notify:()=>{},open:browser.open}),(error:unknown)=>error instanceof CliError&&error.code==='auth_failed');
  assert.equal(await loadConnection(origin,home,{}),null);
  const page=await browser.pages[0]!;assert.equal(page.status,400);assert.match(page.text,/run afbin auth again/);
 }finally{await rm(home,{recursive:true,force:true});}
});
