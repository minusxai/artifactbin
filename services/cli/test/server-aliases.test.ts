import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveReference} from '../src/reference';
import {sameServer,serverAddresses,serverIdentity} from '../src/server-identity';
import {deviceAuthenticate} from '../src/browser-auth';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';
import {stateFor} from '../src/state-access';
import {stageRequest,savePendingResponse} from '../src/pending-request';

// One deployment, two names: a link copied from either is the same artifact on the selected server.
test('a URL at a verified alias of the selected server resolves to its artifact id',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-alias-'));
 try{
  const options={root,server:'https://app.example.com',aliases:['https://example.com']};
  assert.deepEqual(await resolveReference('https://example.com/@sam/abc123-split-tracker?$exp_desc=Dinner',options),{kind:'id',id:'abc123',notices:[]});
  assert.deepEqual(await resolveReference('https://app.example.com/a/abc123@2',options),{kind:'id',id:'abc123',version:2,notices:[]});
 }finally{await rm(root,{recursive:true,force:true});}
});

test('an origin that is neither the server nor one of its aliases is still refused, and names both',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-alias-'));
 try{
  const options={root,server:'https://app.example.com',aliases:['https://example.com']};
  await assert.rejects(resolveReference('https://evil.example/a/abc123',options),(error:Error&{code?:string})=>{
   assert.equal(error.code,'wrong_server');
   assert.match(error.message,/evil\.example/);
   assert.match(error.message,/app\.example\.com/);
   return true;
  });
  await assert.rejects(resolveReference('https://user:pw@example.com/a/abc123',options));
  await assert.rejects(resolveReference('https://example.com/a/abc123',{root,server:'https://app.example.com'}));
 }finally{await rm(root,{recursive:true,force:true});}
});

/*
 * THE TRUST RULE, PROVED ON THE WIRE.
 *
 * Everything below asserts on RECORDED REQUESTS, because the contract is about
 * where bytes go: discovery carries no credential, refuses redirects and is
 * believed only when both origins agree; and once an alias is verified, the
 * bearer token still travels to the canonical origin alone.
 */
const CANONICAL='https://app.example.com';
const ALIAS='https://example.com';

interface Seen {origin:string;path:string;method:string;redirect:string;headers:Record<string,string>}
/** A world of servers keyed by origin: a document to serve, or an HTTP status to refuse with. */
function world(answers:Record<string,unknown>){
 const seen:Seen[]=[];
 const fetcher=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const request=new Request(input as never,init);
  const url=new URL(request.url);
  const headers:Record<string,string>={};request.headers.forEach((value,name)=>{headers[name.toLowerCase()]=value;});
  seen.push({origin:url.origin,path:url.pathname,method:request.method,redirect:request.redirect,headers});
  const answer=answers[`${url.origin}${url.pathname}`]??answers[url.origin];
  if(answer===undefined)return new Response('not found',{status:404});
  if(typeof answer==='number')return new Response('refused',{status:answer});
  // A function answer may look at the REQUEST — one path answering two ways (a dry run and the
  // act) is exactly the fork door's shape.
  if(typeof answer==='function')return (answer as (call:{method:string;body:unknown})=>Response)({method:request.method,body:await request.clone().json().catch(()=>undefined)});
  return Response.json(answer);
 }) as typeof fetch;
 return {seen,fetch:fetcher};
}
const discovery=(seen:Seen[])=>seen.filter(call=>call.path==='/api/server');
const CREDENTIAL_HEADERS=['authorization','cookie','x-artifactbin-account','x-artifactbin-token'];
function assertNoCredentials(calls:Seen[]):void{
 for(const call of calls)for(const header of CREDENTIAL_HEADERS)
  assert.equal(call.headers[header],undefined,`${header} reached ${call.origin}${call.path}`);
}
async function withHome<T>(run:(home:string)=>Promise<T>):Promise<T>{
 const home=await mkdtemp(join(tmpdir(),'afbin-identity-'));
 try{return await run(home);}finally{await rm(home,{recursive:true,force:true});}
}

test('the canonical origin is believed about its own aliases, with one credential-free request',async()=>{
 await withHome(async home=>{
  const net=world({[CANONICAL]:{origin:CANONICAL,aliases:[ALIAS]}});
  const identity=await serverIdentity(CANONICAL,{home,env:{},fetch:net.fetch});
  assert.deepEqual(identity,{selected:CANONICAL,canonical:CANONICAL,aliases:[ALIAS]});
  assert.deepEqual(discovery(net.seen).map(call=>call.origin),[CANONICAL]);
  assert.deepEqual(discovery(net.seen).map(call=>call.redirect),['error']);
  assertNoCredentials(net.seen);
  assert.equal(sameServer(identity,ALIAS),true);
  assert.equal(sameServer(identity,'https://evil.example'),false);
  assert.deepEqual(serverAddresses(identity),[CANONICAL,ALIAS]);
 });
});

test('a selected alias resolves to its canonical only when the canonical confirms it, and never sends a credential there',async()=>{
 await withHome(async home=>{
  const net=world({[ALIAS]:{origin:CANONICAL,aliases:[ALIAS]},[CANONICAL]:{origin:CANONICAL,aliases:[ALIAS]}});
  const identity=await serverIdentity(ALIAS,{home,env:{},fetch:net.fetch});
  assert.deepEqual(identity,{selected:ALIAS,canonical:CANONICAL,aliases:[ALIAS]});
  assert.deepEqual(discovery(net.seen).map(call=>call.origin),[ALIAS,CANONICAL]);
  assertNoCredentials(net.seen);
  assert.equal(sameServer(identity,CANONICAL),true);
 });
});

test('an alias the canonical origin does not confirm is ignored, however the selected origin claims it',async()=>{
 // The canonical answers, but its own document does not name the selected origin.
 await withHome(async home=>{
  const net=world({[ALIAS]:{origin:CANONICAL,aliases:[ALIAS]},[CANONICAL]:{origin:CANONICAL,aliases:['https://other.example']}});
  assert.deepEqual(await serverIdentity(ALIAS,{home,env:{},fetch:net.fetch}),{selected:ALIAS,canonical:ALIAS,aliases:[]});
 });
 // The claimed canonical does not answer at all.
 await withHome(async home=>{
  const net=world({[ALIAS]:{origin:CANONICAL,aliases:[ALIAS]},[CANONICAL]:404});
  assert.deepEqual(await serverIdentity(ALIAS,{home,env:{},fetch:net.fetch}),{selected:ALIAS,canonical:ALIAS,aliases:[]});
 });
 // A chain: the claimed canonical names a further canonical. One hop or nothing.
 await withHome(async home=>{
  const net=world({[ALIAS]:{origin:CANONICAL,aliases:[ALIAS]},[CANONICAL]:{origin:'https://third.example',aliases:[CANONICAL,ALIAS]}});
  assert.deepEqual(await serverIdentity(ALIAS,{home,env:{},fetch:net.fetch}),{selected:ALIAS,canonical:ALIAS,aliases:[]});
 });
});

test('an older server, an unrelated 200 and a malformed origin all mean "no aliases" — exactly today\'s behaviour',async()=>{
 for(const answer of [404,500,{},{origin:42},{origin:'https://example.com/path'},{origin:CANONICAL,aliases:'https://example.com'},{origin:CANONICAL,aliases:['not a url']},{origin:CANONICAL,aliases:['http://public.example']}]){
  await withHome(async home=>{
   const net=world({[CANONICAL]:answer});
   assert.deepEqual(await serverIdentity(CANONICAL,{home,env:{},fetch:net.fetch}),{selected:CANONICAL,canonical:CANONICAL,aliases:[]},JSON.stringify(answer));
  });
 }
 // A server that cannot be reached at all is not a failure either.
 await withHome(async home=>{
  const identity=await serverIdentity(CANONICAL,{home,env:{},fetch:(async()=>{throw new Error('ECONNREFUSED');}) as typeof fetch});
  assert.deepEqual(identity,{selected:CANONICAL,canonical:CANONICAL,aliases:[]});
 });
});

test('a verified relation is cached; an unverified one is re-checked soon after',async()=>{
 await withHome(async home=>{
  const net=world({[CANONICAL]:{origin:CANONICAL,aliases:[ALIAS]}});
  let clock=1_000_000;
  const options={home,env:{},fetch:net.fetch,now:()=>clock};
  await serverIdentity(CANONICAL,options);
  await serverIdentity(CANONICAL,options);
  assert.equal(discovery(net.seen).length,1,'a cached identity makes no second request');
  clock+=25*60*60*1000;
  await serverIdentity(CANONICAL,options);
  assert.equal(discovery(net.seen).length,2,'a day-old identity is read again');
 });
 await withHome(async home=>{
  const net=world({});
  let clock=1_000_000;
  const options={home,env:{},fetch:net.fetch,now:()=>clock};
  await serverIdentity(CANONICAL,options);
  clock+=11*60*1000;
  await serverIdentity(CANONICAL,options);
  assert.equal(discovery(net.seen).length,2,'"no aliases" is remembered only briefly');
 });
});

/** A workspace already registered against `server`, the way a pull leaves it. */
async function trackWorkspace(home:string,root:string,server:string,account='usr_seed'):Promise<void>{
 const scope=await realpath(root);
 (await stateFor(home)).put(scope,'workspace',scope,{server,account});
}
interface CliRun {code:number;out:string[];err:string[]}
async function cli(args:string[],home:string,fetcher:typeof fetch):Promise<CliRun>{
 const out:string[]=[],err:string[]=[];
 const code=await runCli(args,{cwd:home,home,env:{},interactive:false,color:false,
  stdout:(value:string)=>out.push(value),stderr:(value:string)=>err.push(value),
  auth:{open:async()=>{throw new Error('a test must not open a browser');}},fetch:fetcher} as never);
 return {code,out,err};
}

test('a folder tracked against a verified alias runs against the canonical origin, and the token goes only there',async()=>{
 await withHome(async home=>{
  await saveConnection({server:CANONICAL,token:'test-token'},home,{});
  await trackWorkspace(home,home,ALIAS);
  const net=world({
   [`${ALIAS}/api/server`]:{origin:CANONICAL,aliases:[ALIAS]},
   [`${CANONICAL}/api/server`]:{origin:CANONICAL,aliases:[ALIAS]},
   [`${CANONICAL}/api/artifacts`]:{artifacts:[]},
  });
  const run=await cli(['list','--server',CANONICAL,'--json'],home,net.fetch);
  assert.equal(run.code,0,run.err.join('')+run.out.join(''));
  const api=net.seen.filter(call=>call.path!=='/api/server');
  assert.deepEqual(api.map(call=>`${call.origin}${call.path}`),[`${CANONICAL}/api/artifacts`]);
  assert.equal(api[0]!.headers.authorization,'Bearer test-token');
  assertNoCredentials(discovery(net.seen));
  // Not one byte reached the alias: the canonical origin's own document settled the relation.
  assert.deepEqual(net.seen.filter(call=>call.origin===ALIAS).map(call=>call.path),[]);
 });
});

test('credentials saved under a verified alias keep working, and are spent on the canonical origin',async()=>{
 await withHome(async home=>{
  await saveConnection({server:ALIAS,token:'alias-token'},home,{});
  const net=world({
   [`${CANONICAL}/api/server`]:{origin:CANONICAL,aliases:[ALIAS]},
   [`${CANONICAL}/api/artifacts`]:{artifacts:[]},
  });
  const run=await cli(['list','--server',CANONICAL,'--json'],home,net.fetch);
  assert.equal(run.code,0,run.err.join('')+run.out.join(''));
  const api=net.seen.filter(call=>call.path!=='/api/server');
  assert.deepEqual(api.map(call=>`${call.origin}${call.path}`),[`${CANONICAL}/api/artifacts`]);
  assert.equal(api[0]!.headers.authorization,'Bearer alias-token');
 });
});

test('an unverified origin is still a different server: the command is refused and names both',async()=>{
 await withHome(async home=>{
  await saveConnection({server:CANONICAL,token:'test-token'},home,{});
  await trackWorkspace(home,home,ALIAS);
  // The canonical does not confirm the alias, so the two stay different servers.
  const net=world({
   [`${ALIAS}/api/server`]:{origin:CANONICAL,aliases:[ALIAS]},
   [`${CANONICAL}/api/server`]:{origin:CANONICAL,aliases:[]},
   [`${CANONICAL}/api/artifacts`]:{artifacts:[]},
  });
  const run=await cli(['list','--server',CANONICAL,'--json'],home,net.fetch);
  assert.equal(run.code,2);
  const failure=JSON.parse(run.out.join('')) as {error:{code:string;message:string;fix:string}};
  assert.equal(failure.error.code,'wrong_server');
  assert.match(failure.error.message,/example\.com/);
  assert.match(failure.error.message,/app\.example\.com/);
  assert.match(failure.error.fix,/--server https:\/\/example\.com/);
  assert.equal(net.seen.some(call=>call.path==='/api/artifacts'),false,'nothing was sent before the refusal');
 });
});

test('browser approval at a verified alias of the selected server is not an origin mismatch',async()=>{
 const deviceCode='a'.repeat(43);
 const pairing=(verificationOrigin:string)=>(async(input:RequestInfo|URL)=>{
  const url=new URL(new Request(input as never).url);
  if(url.pathname==='/oauth/device')return Response.json({device_code:deviceCode,user_code:'ABCD-EFGH',
   verification_uri_complete:`${verificationOrigin}/oauth/device`,expires_in:300,interval:5});
  return Response.json({error:'access_denied'},{status:400});
 }) as typeof fetch;
 // Verified: the approval page lives on the canonical origin of the selected alias.
 await withHome(async home=>{
  await assert.rejects(deviceAuthenticate(ALIAS,{home,env:{},interactive:false,fetch:pairing(CANONICAL),
   aliases:[CANONICAL,ALIAS],notify:()=>{},open:async()=>{},sleep:async()=>{}}),
   (error:Error&{code?:string})=>{assert.equal(error.code,'access_denied');return true;});
 });
 // Unverified: an origin nobody vouched for is still refused, before any polling.
 await withHome(async home=>{
  await assert.rejects(deviceAuthenticate(ALIAS,{home,env:{},interactive:false,fetch:pairing('https://evil.example'),
   notify:()=>{},open:async()=>{},sleep:async()=>{}}),
   (error:Error&{code?:string})=>{assert.equal(error.code,'approval_origin_mismatch');return true;});
 });
});

test('preview binds a folder tracked against a verified alias to the canonical origin',async()=>{
 await withHome(async home=>{
  await saveConnection({server:CANONICAL,token:'test-token'},home,{});
  await trackWorkspace(home,home,ALIAS);
  await writeFile(join(home,'doc.jsx'),'<p>Draft</p>');
  const net=world({
   [`${CANONICAL}/api/server`]:{origin:CANONICAL,aliases:[ALIAS]},
   [`${CANONICAL}/api/artifacts`]:()=>Response.json({artifacts:[]},{headers:{'X-Artifactbin-Account':'usr_seed'}}),
   [`${CANONICAL}/api/artifacts/reservations`]:()=>Response.json({ids:Array.from({length:100},(_,index)=>'S'+String(index).padStart(5,'0'))},{headers:{'X-Artifactbin-Account':'usr_seed'}}),
  });
  let served:{server?:string}|undefined;
  const out:string[]=[];
  const code=await runCli(['preview','doc.jsx','--server',CANONICAL,'--json'],{cwd:home,home,env:{},interactive:false,color:false,
   stdout:(value:string)=>out.push(value),stderr:()=>{},fetch:net.fetch,
   preview:async(options:{server?:string})=>{served=options;return 0;},
   auth:{open:async()=>{throw new Error('a test must not open a browser');}}} as never);
  assert.equal(code,0,out.join(''));
  assert.equal(served?.server,CANONICAL);
  assert.deepEqual(net.seen.filter(call=>call.origin===ALIAS),[]);
 });
});

// Found with the released binary against production: the pre-flight took the alias list, the two
// functions that DO the pull did not, so a link pasted from the other hostname was still wrong_server.
for(const [name,args] of [['to a file',['--output','doc.jsx','--json']],['to stdout',['--output','-']]] as const)test(`pull accepts a link at a verified alias of the selected server (${name}), and asks the canonical origin for it`,async()=>{
 await withHome(async home=>{
  await saveConnection({server:CANONICAL,token:'test-token'},home,{});
  const head={id:'abc123',version:1,edit_id:'one',state:'a'.repeat(64),format:'markup',markup:'<p>Hello</p>',title:'Doc'};
  const net=world({
   [`${CANONICAL}/api/server`]:{origin:CANONICAL,aliases:[ALIAS]},
   [`${CANONICAL}/api/artifacts/abc123`]:()=>Response.json(head,{headers:{'X-Artifactbin-Account':'usr_seed'}}),
  });
  const run=await cli(['pull',`${ALIAS}/@sam/abc123-doc?$x=1`,...args,'--server',CANONICAL],home,net.fetch);
  assert.equal(run.code,0,run.err.join('')+run.out.join(''));
  const api=net.seen.filter(call=>call.path!=='/api/server');
  assert.deepEqual([...new Set(api.map(call=>call.origin))],[CANONICAL]);
  assert.deepEqual(net.seen.filter(call=>call.origin===ALIAS).map(call=>call.path),[]);
 });
});

// Every OTHER command that takes a link: none may call a verified alias a wrong server, and none may
// send a byte to it. The fake canonical origin answers only the identity question, so a command may
// fail for its own reasons (not_found) — what is pinned is that the LINK was understood.
for(const args of [['query'],['log'],['comment'],['open'],['export','--format','original','--output','out.jsx'],['fork','--output','copy.jsx'],['delete','--dry-run']] as const)test(`${args[0]} understands a link at a verified alias of the selected server`,async()=>{
 await withHome(async home=>{
  await saveConnection({server:CANONICAL,token:'test-token'},home,{});
  const net=world({[`${CANONICAL}/api/server`]:{origin:CANONICAL,aliases:[ALIAS]}});
  const [command,...rest]=args;
  const run=await cli([command,`${ALIAS}/a/abc123?$x=1`,...rest,'--server',CANONICAL,'--json'],home,net.fetch);
  assert.doesNotMatch(run.out.join('')+run.err.join(''),/wrong_server/);
  assert.deepEqual(net.seen.filter(call=>call.origin===ALIAS).map(call=>call.path),[]);
 });
});

/*
 * FORKING AN APP from an alias link is the one fork that talks to the server several times — the
 * snapshot, the dry run, the fork itself, and the pull of the copy it made. The row above pins
 * that the LINK is understood; this pins that every one of those calls, credential included, goes
 * to the canonical origin and none of them to the alias.
 */
test('forking an app at a verified alias asks the canonical origin for every step',async()=>{
 await withHome(async home=>{
  await saveConnection({server:CANONICAL,token:'test-token'},home,{});
  const app=(dataset:string)=>`<Helmet><Mutation name="join" source="ref:${dataset}">{\`insert into public.rows (who) select $_me\`}</Mutation></Helmet><div><Button run="$join">Join</Button></div>`;
  const page={id:'abc123',version:1,edit_id:'one',state:'a'.repeat(64),format:'markup',title:'Tracker',markup:app('ds0001')};
  const net=world({
   [`${CANONICAL}/api/server`]:{origin:CANONICAL,aliases:[ALIAS]},
   [`${CANONICAL}/api/artifacts/abc123`]:()=>Response.json(page,{headers:{'X-Artifactbin-Account':'usr_seed'}}),
   [`${CANONICAL}/api/artifacts/abc123/fork`]:(call:{method:string;body:unknown})=>Response.json(
    (call.body as {dry_run?:boolean})?.dry_run?{datasets:[{id:'ds0001',title:'tab'}]}
     :{id:'cpy001',url:`${CANONICAL}/a/cpy001`,visibility:'unlisted',forked_from:'abc123',datasets:[{id:'ds0009',forked_from:'ds0001'}]},
    {headers:{'X-Artifactbin-Account':'usr_seed'}}),
   [`${CANONICAL}/api/artifacts/cpy001`]:()=>Response.json({...page,id:'cpy001',markup:app('ds0009')},{headers:{'X-Artifactbin-Account':'usr_seed'}}),
  });
  const run=await cli(['fork',`${ALIAS}/a/abc123?$x=1`,'--output','copy.jsx','--server',CANONICAL,'--json'],home,net.fetch);
  assert.equal(run.code,0,run.err.join('')+run.out.join(''));
  const file=await readFile(join(home,'copy.jsx'),'utf8');
  assert.match(file,/ref:ds0009/);
  assert.match(file,/id: cpy001/,'the local file tracks the copy the server made');
  const api=net.seen.filter(call=>call.path!=='/api/server');
  assert.deepEqual([...new Set(api.map(call=>call.origin))],[CANONICAL]);
  assert.deepEqual(api.filter(call=>call.method==='DELETE'),[],'the page the server forked stays');
  assert.deepEqual(net.seen.filter(call=>call.origin===ALIAS).map(call=>call.path),[]);
 });
});

// A write journaled under the OLD hostname, before the folder healed, is still this server's write.
test('a saved reply journaled under a verified alias finishes recovery on the canonical origin',async()=>{
 await withHome(async home=>{
  await saveConnection({server:ALIAS,token:'alias-token'},home,{});
  await trackWorkspace(home,home,ALIAS,'usr_one');
  const body='<p>Saved reply</p>';await writeFile(join(home,'doc.jsx'),body);
  const scope=await realpath(home);
  const pending=await stageRequest(home,scope,{server:ALIAS,account:'usr_one',credential:'old-credential-hash',request:{path:'/artifacts',method:'POST',body:{markup:body}},file:{path:'doc.jsx',bytes:Buffer.from(body).toString('base64')}});
  await savePendingResponse(home,scope,pending,{id:'abc123',version:1,edit_id:'one',state:'a'.repeat(64),format:'markup',markup:'<p id="p001">Saved reply</p>'},'usr_one');
  const net=world({
   [`${ALIAS}/api/server`]:{origin:CANONICAL,aliases:[ALIAS]},
   [`${CANONICAL}/api/server`]:{origin:CANONICAL,aliases:[ALIAS]},
  });
  const run=await cli(['push','doc.jsx','--server',CANONICAL,'--json'],home,net.fetch);
  assert.equal(run.code,0,run.err.join('')+run.out.join(''));
  assert.doesNotMatch(run.out.join('')+run.err.join(''),/account_mismatch/);
  assert.ok(!(await stateFor(home)).get(scope,'pending-request','current'),'the recovery record is cleared');
 });
});
