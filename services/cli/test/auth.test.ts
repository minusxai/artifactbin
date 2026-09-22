import {test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCli} from '../src/dispatch';
import {loadConnection,saveConnection} from '../src/config';
import {browserAuthenticate,deviceAuthenticate} from '../src/browser-auth';
import {CliError} from '../src/commands';
import {createHash} from 'node:crypto';
import {loopbackAuthenticate} from '../src/loopback-auth';


const origin='https://example.com';
const pairing=()=>Response.json({device_code:'d'.repeat(43),user_code:'ABCD',verification_uri_complete:origin+'/oauth/device?user_code=ABCD',expires_in:10,interval:5});
const credentials=()=>Response.json({access_token:'new_access',refresh_token:'new_refresh',client_id:'client',expires_in:3600});

test('afbin auth is a no-op on a valid saved token: one read, reports the account, no browser',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-auth-valid-'));const paths:string[]=[];const output:string[]=[];
 try{
  await saveConnection({server:origin,token:'saved_access'},home);
  const code=await runCli(['auth','--server',origin,'--json'],{
   home,cwd:home,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},
   auth:{open:async()=>assert.fail('a valid token must not open a browser')},
   fetch:async(input,init)=>{
    const url=new URL(String(input));paths.push(url.pathname);
    // Before any credential is spent, the selected origin is asked which addresses it answers at
    // — public, cacheable and unauthenticated (services/cli/src/server-identity).
    if(url.pathname==='/api/server'){assert.equal(new Headers(init?.headers).get('Authorization'),null);return Response.json({origin,aliases:[]});}
    assert.equal(url.pathname,'/api/artifacts');
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer saved_access');
    return Response.json({artifacts:[]},{headers:{'X-Artifactbin-Account':'acct_1'}});
   },
  });
  assert.equal(code,0,output.join(''));assert.deepEqual(paths,['/api/server','/api/artifacts']);
  assert.deepEqual(JSON.parse(output.join('')),{authenticated:true,server:origin,account:'acct_1'});
 }finally{await rm(home,{recursive:true,force:true});}
});

test('afbin auth reports anonymous when the server names no account',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-auth-anon-'));const output:string[]=[];
 try{
  await saveConnection({server:origin,token:'saved_access'},home);
  const code=await runCli(['auth','--server',origin,'--json'],{home,cwd:home,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>Response.json({artifacts:[]})});
  assert.equal(code,0);assert.equal(JSON.parse(output.join('')).account,'anonymous');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('afbin auth with no saved token runs the browser approval flow and saves the credential',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-auth-none-'));const output:string[]=[];const calls:string[]=[];
 try{
  const code=await runCli(['auth','--server',origin,'--json'],{
   home,cwd:home,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},
   auth:{open:async()=>{}},
   fetch:async input=>{const path=new URL(String(input)).pathname;calls.push(path);return path==='/api/server'?Response.json({origin,aliases:[]}):path==='/oauth/device'?pairing():credentials();},
  });
  assert.equal(code,0,output.join(''));
  assert.deepEqual(JSON.parse(output.join('')),{authenticated:true,server:origin});
  assert.deepEqual(calls,['/api/server','/oauth/device','/oauth/device/token']);
  assert.equal((await loadConnection(origin,home,{}))?.token,'new_access');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('afbin auth surfaces the structured denial error and relays the verification URL on stderr',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-auth-denied-'));const output:string[]=[];const diagnostics:string[]=[];
 try{
  const code=await runCli(['auth','--server',origin,'--json'],{
   home,cwd:home,env:{},interactive:false,stdout:s=>output.push(s),stderr:s=>diagnostics.push(s),
   auth:{open:async()=>{}},
   fetch:async input=>new URL(String(input)).pathname==='/oauth/device'?pairing():Response.json({error:'access_denied'},{status:400}),
  });
  assert.equal(code,2);
  assert.equal(JSON.parse(output.join('')).error.code,'access_denied');
  // The verification URL and code reach a relaying caller through the existing notify channel.
  assert.match(diagnostics.join(''),/\/oauth\/device\?user_code=ABCD/);
  assert.match(diagnostics.join(''),/ABCD/);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('afbin auth unattended surfaces approval_expired when the window closes',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-auth-expired-'));const output:string[]=[];let now=0;
 try{
  const code=await runCli(['auth','--server',origin,'--json'],{
   home,cwd:home,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},
   auth:{open:async()=>{},now:()=>now,sleep:async ms=>{now+=ms;}},
   fetch:async input=>new URL(String(input)).pathname==='/oauth/device'?pairing():Response.json({error:'authorization_pending'},{status:400}),
  });
  assert.equal(code,2);
  assert.equal(JSON.parse(output.join('')).error.code,'approval_expired');
  assert.match(JSON.parse(output.join('')).error.fix,/--email/);
  assert.equal(await loadConnection(origin,home,{}),null);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('eager init installs the detected skill on a local command and is idempotent, offline',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-init-local-'));const bin=join(home,'bin');
 try{
  await mkdir(bin);await writeFile(join(bin,'pi'),'#!/bin/sh\nexit 1\n',{mode:0o755});
  const env={PATH:bin};const skill=join(home,'.pi','agent','skills','artifactbin','SKILL.md');
  const first:string[]=[];
  assert.equal(await runCli(['help'],{home,cwd:home,env,interactive:false,stdout:()=>{},stderr:s=>first.push(s),fetch:async()=>assert.fail('init must stay offline')}),0);
  assert.match(await readFile(skill,'utf8'),/name: artifactbin/);
  assert.match(first.join(''),/Skill installed:/);
  const second:string[]=[];
  assert.equal(await runCli(['help'],{home,cwd:home,env,interactive:false,stdout:()=>{},stderr:s=>second.push(s),fetch:async()=>assert.fail('init must stay offline')}),0);
  assert.equal(second.join(''),'','a current skill is not reinstalled');
  // afbin status reports each harness' skill directory and whether it is installed/current, offline.
  const st:string[]=[];
  assert.equal(await runCli(['status','--json'],{home,cwd:home,env,interactive:false,stdout:s=>st.push(s),stderr:()=>{},fetch:async()=>assert.fail('status is local')}),0);
  const skills=JSON.parse(st.join('')).skills as Array<{harness:string;path:string;installed:boolean;current:boolean}>;
  assert.equal(skills.length,4);
  const pi=skills.find(x=>x.harness==='pi')!;
  assert.equal(pi.path,join(home,'.pi','agent','skills','artifactbin'));
  assert.equal(pi.installed,true);assert.equal(pi.current,true);
  assert.equal(skills.find(x=>x.harness==='codex')!.installed,false);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('browser approval saves and reuses credentials in the process-configured home', async () => {
 const home=await mkdtemp(join(tmpdir(),'afbin-auth-root-'));
 const previous=process.env.ARTIFACTBIN_HOME;
 const root=join(home,'custom');
 process.env.ARTIFACTBIN_HOME=root;
 try {
  const connection=await browserAuthenticate(origin,{home,interactive:false,open:async()=>{},notify:()=>{},
   fetch:async input=>new URL(String(input)).pathname==='/oauth/device'?pairing():credentials()});
  assert.deepEqual(await loadConnection(origin,home,{ARTIFACTBIN_HOME:root}),connection);
  await assert.rejects(stat(join(home,'.artifactbin','.env')),{code:'ENOENT'});
  assert.deepEqual(await browserAuthenticate(origin,{home,interactive:false,
   fetch:async()=>assert.fail('saved credentials must avoid another approval')}),connection);
 } finally {
  if(previous===undefined)delete process.env.ARTIFACTBIN_HOME;else process.env.ARTIFACTBIN_HOME=previous;
  await rm(home,{recursive:true,force:true});
 }
});

describe('browser device approval', () => {
  test('interrupted pairing resumes and persists credentials without a validation GET', async () => {
    const home = await mkdtemp(join(tmpdir(), 'afbin-pair-'));
    const calls: string[] = [];
    let approved = false;
    const request: typeof fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (path === '/oauth/device') return Response.json({device_code:'d'.repeat(43),user_code:'1234-5678-ABCD-EF12', verification_uri_complete:'https://example.com/oauth/device?user_code=1234-5678-ABCD-EF12',expires_in:300,interval:5});
      if (path === '/oauth/device/token') return approved
        ? Response.json({access_token:'mx_access', refresh_token:'mxr_refresh', client_id:'afbin_client',expires_in:21600})
        : Response.json({error:'authorization_pending'}, {status:400});
      throw new Error(`Unexpected request ${path}`);
    };
    try {
      await assert.rejects(browserAuthenticate('https://example.com', {home, fetch:request, interactive:false,open:async()=>{},notify:()=>{},sleep:async()=>{throw new Error('interrupted');}}), /interrupted/);
      assert.equal((await stat(join(home,'.artifactbin'))).mode & 0o777, 0o700);
      approved = true;
      const connection = await browserAuthenticate('https://example.com', {home, fetch:request, interactive:false,open:async()=>{},notify:()=>{}});
      assert.equal(connection.token,'mx_access');
      assert.deepEqual(await loadConnection(connection.server,home,{}),connection);
      assert.equal(calls.filter(x=>x==='/oauth/device').length,1);
      assert.ok(calls.every(x=>x.startsWith('/oauth/')));
    } finally {await rm(home,{recursive:true,force:true});}
  });

  test('interactive flow opens the browser and bounded polling never implies approval', async () => {
    const home = await mkdtemp(join(tmpdir(),'afbin-pair-'));
    let now = 1000;
    let opened = 0;
    const request: typeof fetch = async input => String(input).endsWith('/oauth/device')
      ? Response.json({device_code:'d'.repeat(43), user_code:'code', verification_uri_complete:'https://example.com/oauth/device?user_code=code', expires_in:10, interval:5})
      : Response.json({error:'authorization_pending'}, {status:400});
    try {
      await assert.rejects(deviceAuthenticate('https://example.com',{home,fetch:request,interactive:true,now:()=>now,sleep:async ms=>{now+=ms;},open:async()=>{opened++;},notify:()=>{}}),(error:unknown)=>error instanceof CliError&&error.code==='approval_expired');
      assert.equal(opened,1);
      assert.equal(now,11000);
      assert.equal(await loadConnection(undefined,home,{}),null);
    } finally {await rm(home,{recursive:true,force:true});}
  });

  test('device denial has a stable error code and leaves no credentials',async()=>{
   const home=await mkdtemp(join(tmpdir(),'afbin-denied-'));
   try{
    await assert.rejects(deviceAuthenticate('https://example.com',{home,interactive:false,open:async()=>{},notify:()=>{},fetch:async input=>String(input).endsWith('/oauth/device')
     ?Response.json({device_code:'d'.repeat(43),user_code:'code',verification_uri_complete:'https://example.com/oauth/device?user_code=code',expires_in:300,interval:5})
     :Response.json({error:'access_denied'},{status:400})}),error=>error instanceof CliError&&error.code==='access_denied');
    assert.equal(await loadConnection(undefined,home,{}),null);
   }finally{await rm(home,{recursive:true,force:true});}
  });
});

describe('browser loopback approval', () => {
  function assertPage(response: Response, html: string, heading: string) {
   assert.match(response.headers.get('content-type')??'',/text\/html/);
   assert.equal(response.headers.get('cache-control'),'no-store');
   assert.match(response.headers.get('content-security-policy')??'',/frame-ancestors 'none'/);
   assert.match(html,/<div class="brand">artifactbin<\/div>/);
   assert.ok(html.includes(`<h1>${heading}</h1>`));
  }
  test('denied approval renders the branded page without exchanging or saving credentials',async()=>{
   const home=await mkdtemp(join(tmpdir(),'afbin-loopback-denied-'));let exchanges=0;let response!:Response;let html='';
   try{
    await assert.rejects(loopbackAuthenticate('https://example.com',{home,timeoutMs:3000,open:async raw=>{
     const url=new URL(raw);const callback=new URL(url.searchParams.get('redirect_uri')!);
     callback.search=new URLSearchParams({error:'access_denied',state:url.searchParams.get('state')!}).toString();
     response=await fetch(callback);html=await response.text();
    },fetch:async input=>{
     if(String(input).endsWith('/oauth/register'))return Response.json({client_id:'afbin_client'});
     exchanges++;throw new Error('Unexpected token exchange');
    }}),error=>error instanceof CliError&&error.code==='access_denied');
    assert.equal(response.status,200);assertPage(response,html,'Connection denied');
    assert.equal(exchanges,0);assert.equal(await loadConnection(undefined,home,{}),null);
   }finally{await rm(home,{recursive:true,force:true});}
  });
  test('browser loopback checks state and PKCE before saving credentials',async()=>{
   const home=await mkdtemp(join(tmpdir(),'afbin-loopback-'));let challenge='';let callback='';let exchanges=0;let state='';
   const pages:Array<{response:Response;html:string}>=[];
   try{
    const connection=await loopbackAuthenticate('https://example.com',{home,timeoutMs:3000,notify:()=>{},open:async raw=>{
     const url=new URL(raw);challenge=url.searchParams.get('code_challenge')!;callback=url.searchParams.get('redirect_uri')!;state=url.searchParams.get('state')!;
     for(const query of ['?code=wrong&state=wrong','?state='+state,'?code=approved&state='+state,'?code=approved&state='+state]){
      const response=await fetch(callback+query);pages.push({response,html:await response.text()});
     }
    },fetch:async(input,init)=>{
     const body=JSON.parse(String(init?.body));
     if(String(input).endsWith('/oauth/register'))return Response.json({client_id:'afbin_client'},{status:201});
     exchanges++;assert.equal(body.code,'approved');assert.equal(body.redirect_uri,callback);assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'),challenge);assert.equal(body.resource,'https://example.com/api');
     return Response.json({access_token:'access',refresh_token:'refresh',expires_in:3600});
    }});
    assert.equal(new URL(callback).hostname,'127.0.0.1');
    assert.deepEqual(pages.map(p=>p.response.status),[400,400,200,409]);
    for(const [i,heading] of ['Invalid callback','Missing authorization code','Approval received','Approval already received'].entries()){
     assertPage(pages[i]!.response,pages[i]!.html,heading);assert.ok(!pages[i]!.html.includes(state));
    }
    assert.equal(exchanges,1);assert.equal(connection.token,'access');assert.deepEqual(await loadConnection(connection.server,home,{}),connection);
   }finally{await rm(home,{recursive:true,force:true});}
  });
});

describe('which origin the approval uses', () => {
  for(const saved of [false,true])for(const explicit of [false,true]){
   test(`auth uses the selected origin without credentials (saved=${saved}, flag=${explicit})`,async()=>{
    const home=await mkdtemp(join(tmpdir(),'afbin-origin-'));
    const selected=explicit?'http://localhost:7244':'http://localhost:7242';
    const calls:string[]=[];const output:string[]=[];
    try{
     if(saved)await saveConnection({server:'https://artifactbin.dev',token:'mx_saved'},home);
     const code=await runCli(['auth','--json',...(explicit?['--server',selected]:[])],{
      home,cwd:home,env:{ARTIFACTBIN_URL:'http://localhost:7242'},interactive:false,auth:{open:async()=>{}},stdout:s=>output.push(s),stderr:()=>{},
      fetch:async input=>{
       const url=new URL(String(input));calls.push(url.origin);
       return url.pathname==='/oauth/device'
        ?Response.json({device_code:'d'.repeat(43),user_code:'ABCD-EFGH',verification_uri_complete:selected+'/oauth/device?user_code=ABCD-EFGH',expires_in:300,interval:5})
        :Response.json({access_token:'access',refresh_token:'refresh',client_id:'client',expires_in:3600});
      },
     });
     assert.equal(code,0);
     // Three requests, ONE origin: the identity document, the pairing and the token exchange all
     // go to the origin this command selected, and to nothing else.
     assert.deepEqual(calls,[selected,selected,selected]);
     assert.equal(JSON.parse(output.join('')).server,selected);
    }finally{await rm(home,{recursive:true,force:true});}
   });
  }
});

describe('a rejected token mid-command', () => {
  /** `remote` rides the shared client, so a rejected token starts browser sign-in and the command resumes with the new one. */
  test('a rejected token on afbin remote starts sign-in immediately and resumes the session with the approved credential',async()=>{
   const root=await mkdtemp(join(tmpdir(),'afbin-remote-auth-'));
   try{
    await saveConnection({server:'https://example.com',token:'stale'},root);
    const calls:string[]=[];const out:string[]=[];const err:string[]=[];
    const view={session:{id:'rs_1',name:'pi',harness:'pi',cwd:'/w',machine:'m',cols:80,rows:24,online:false,exitCode:0,controller:'local',createdAt:'2026-09-11T00:00:00Z'},generation:'g1',seq:0,frames:[],snapshot:''};
    const code=await runCli(['remote','--session','rs_1','--server','https://example.com'],{cwd:root,home:root,env:{},interactive:false,auth:{open:async()=>{}},stdout:s=>out.push(s),stderr:s=>err.push(s),fetch:async(input,init)=>{
     const request=new Request(input,init);const path=new URL(request.url).pathname;const token=request.headers.get('Authorization');
     calls.push(`${request.method} ${path} ${token??''}`.trim());
     if(path==='/oauth/device')return Response.json({device_code:'d'.repeat(43),user_code:'ABCD',verification_uri_complete:'https://example.com/oauth/device?code=ABCD',expires_in:300,interval:5});
     if(path==='/oauth/device/token')return Response.json({access_token:'mx_fresh',refresh_token:'mxr_fresh',client_id:'afbin_client',expires_in:3600});
     if(path==='/api/remote/sessions/rs_1')return token==='Bearer mx_fresh'?Response.json(view):Response.json({error:'unauthorized'},{status:401});
     return Response.json({error:'not_found'},{status:404});
    }});
    assert.equal(code,0,out.join('')+err.join(''));
    const refused=calls.indexOf('GET /api/remote/sessions/rs_1 Bearer stale');
    const signIn=calls.findIndex(call=>call.startsWith('POST /oauth/device'));
    const resumed=calls.indexOf('GET /api/remote/sessions/rs_1 Bearer mx_fresh');
    assert.ok(refused>=0&&signIn>refused&&resumed>signIn,`refuse, sign in, resume:\n${calls.join('\n')}`);
    assert.doesNotMatch(err.join(''),/at .*\.ts:\d+/);
   }finally{await rm(root,{recursive:true,force:true});}
  });
});


describe('email authentication',()=>{
 for(const otp of [undefined,'123456'])test(otp?'email OTP approves and saves a CLI connection without a browser':'email sends an OTP and returns instructions without waiting',async()=>{
  const home=await mkdtemp(join(tmpdir(),'afbin-email-'));const output:string[]=[];const calls:string[]=[];
  try{
   await saveConnection({server:origin,token:'previous'},home);
   const code=await runCli(['auth','--email','mxmx_test_remote@example.com',...(otp?['--otp',otp]:[]),'--server',origin,'--json'],{
    home,cwd:home,env:{ARTIFACTBIN_SKILLS:'off'},interactive:false,stdout:s=>output.push(s),stderr:()=>{},auth:{open:async()=>assert.fail('email must never open a browser')},
    fetch:async(input,init)=>{
     const path=new URL(String(input)).pathname;calls.push(path);const headers=new Headers(init?.headers);
     assert.equal(headers.get('Authorization'),null);
     if(path==='/api/server')return Response.json({origin,aliases:[]});
     if(path==='/api/auth/email-otp/send-verification-otp'){assert.deepEqual(JSON.parse(String(init?.body)),{email:'mxmx_test_remote@example.com',type:'sign-in'});return Response.json({success:true});}
     if(path==='/api/auth/sign-in/email-otp'){assert.deepEqual(JSON.parse(String(init?.body)),{email:'mxmx_test_remote@example.com',otp});return Response.json({token:'temporary'},{headers:{'set-cookie':'session=temporary; Path=/; HttpOnly'}});}
     if(path==='/oauth/device')return pairing();
     if(path==='/oauth/device/approve'){assert.equal(headers.get('cookie'),'session=temporary');assert.equal(headers.get('origin'),origin);assert.equal(new URLSearchParams(String(init?.body)).get('user_code'),'ABCD');return new Response('approved');}
     if(path==='/oauth/device/token')return credentials();
     if(path==='/api/auth/sign-out'){assert.equal(headers.get('cookie'),'session=temporary');return Response.json({success:true});}
     assert.fail('Unexpected request '+path);
    },
   });
   assert.equal(code,otp?0:2,output.join(''));
   assert.equal((await loadConnection(origin,home,{}))?.token,otp?'new_access':'previous');
   assert.doesNotMatch(output.join(''),/temporary|new_access|new_refresh/);
   if(otp){assert.ok(calls.includes('/api/auth/sign-out'));assert.ok(!calls.includes('/api/auth/email-otp/send-verification-otp'));}
   else {assert.equal(JSON.parse(output.join('')).error.code,'otp_required');assert.match(JSON.parse(output.join('')).error.fix,/--otp/);assert.deepEqual(calls,['/api/server','/api/auth/email-otp/send-verification-otp']);}
  }finally{await rm(home,{recursive:true,force:true});}
 });
 test('a rejected OTP leaves the previous credentials intact and does not start pairing',async()=>{
  const home=await mkdtemp(join(tmpdir(),'afbin-email-rejected-'));const output:string[]=[];
  try{
   await saveConnection({server:origin,token:'previous'},home);
   const code=await runCli(['auth','--email','mxmx_test_remote@example.com','--otp','123456','--server',origin,'--json'],{home,cwd:home,env:{ARTIFACTBIN_SKILLS:'off'},interactive:false,stdout:s=>output.push(s),stderr:()=>{},auth:{open:async()=>assert.fail('browser')},fetch:async input=>{
    const path=new URL(String(input)).pathname;if(path==='/api/server')return Response.json({origin,aliases:[]});assert.equal(path,'/api/auth/sign-in/email-otp');return Response.json({message:'secret server detail'},{status:400});
   }});
   assert.equal(code,2);assert.equal(JSON.parse(output.join('')).error.code,'otp_rejected');assert.doesNotMatch(output.join(''),/secret server detail/);assert.equal((await loadConnection(origin,home,{}))?.token,'previous');
  }finally{await rm(home,{recursive:true,force:true});}
 });
});

for(const failure of ['launch','timeout'])test('loopback '+failure+' reports email recovery',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-loopback-fallback-'));const notices:string[]=[];
 try{await assert.rejects(loopbackAuthenticate(origin,{home,timeoutMs:10,notify:s=>notices.push(s),open:async()=>{if(failure==='launch')throw new Error('unavailable');},fetch:async()=>Response.json({client_id:'client'})}),e=>e instanceof CliError&&e.code===(failure==='launch'?'browser_unavailable':'approval_expired')&&/--email/.test(e.fix??''));assert.match(notices.join(''),/--email/);}
 finally{await rm(home,{recursive:true,force:true});}
});

for(const args of [ ['--otp','123456'], ['--email','bad-address'], ['--email','a@example.com','--otp','oops'], ['abc123','--email','a@example.com'] ])test('invalid email auth arguments fail before network: '+args.join(' '),async()=>{
 const output:string[]=[];
 assert.equal(await runCli(['auth',...args,'--json'],{env:{ARTIFACTBIN_SKILLS:'off'},stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('invalid input must stay offline')}),2);
 assert.equal(JSON.parse(output.join('')).error.code,'invalid_arguments');
});

for(const failure of ['send','cookie','approve','token'])test('email '+failure+' failure never replaces existing credentials',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-email-failure-'));const output:string[]=[];let signedOut=false;
 try{
  await saveConnection({server:origin,token:'previous'},home);
  const code=await runCli(['auth','--email','mxmx_test_remote@example.com',...(failure==='send'?[]:['--otp','123456']),'--server',origin,'--json'],{home,cwd:home,env:{ARTIFACTBIN_SKILLS:'off'},interactive:false,stdout:s=>output.push(s),stderr:()=>{},auth:{open:async()=>assert.fail('browser')},fetch:async input=>{
   const path=new URL(String(input)).pathname;
   if(path==='/api/server')return Response.json({origin,aliases:[]});
   if(path==='/api/auth/email-otp/send-verification-otp')return Response.json({}, {status:429});
   if(path==='/api/auth/sign-in/email-otp')return Response.json({}, {headers:failure==='cookie'?{}:{'set-cookie':'session=temporary; HttpOnly'}});
   if(path==='/oauth/device')return pairing();
   if(path==='/oauth/device/approve')return new Response('',{status:failure==='approve'?403:200});
   if(path==='/oauth/device/token')return Response.json({access_token:'incomplete'});
   if(path==='/api/auth/sign-out'){signedOut=true;return Response.json({});}
   assert.fail('unexpected '+path);
  }});
  assert.equal(code,2);assert.equal((await loadConnection(origin,home,{}))?.token,'previous');
  assert.equal(signedOut,failure==='approve'||failure==='token');
  assert.equal(JSON.parse(output.join('')).error.code,({send:'otp_send_failed',cookie:'invalid_response',approve:'auth_failed',token:'invalid_response'})[failure]);
 }finally{await rm(home,{recursive:true,force:true});}
});
