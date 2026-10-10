import {helpDocument} from '../src/teaching';
import {createDocumentGraph,applyGraphPatch,graphSource} from '../../app/lib/cli-toolkit';
import {digest} from '../src/files';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setupDestination,groupDestination} from '../src/group-destination';
import {HttpClient} from '../src/http';
import {runCli} from '../src/dispatch';
import {readClientDefaults,setClientDefault} from '../src/config';
import {saveTestConnection,seedIdentityPool} from './connection';
import {parseCommand} from '../src/commands';

test('group setup authenticates recipient, resolves identity, then writes preference before explicit host',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-group-setup-'));const out:string[]=[];const calls:string[]=[];
 try{
  await saveTestConnection({server:'https://groups.example',token:'recipient'},home);
  await setClientDefault('host','https://previous.example',home,{});
  const code=await runCli(['setup','--server','https://groups.example','--group','research','--set-default','--harness','none','--no-global','--json'],{home,cwd:home,env:{ARTIFACTBIN_UPDATES:'off'},interactive:false,stdout:s=>out.push(s),stderr:s=>out.push(s),fetch:async(url,init)=>{
   const path=new URL(String(url)).pathname;calls.push(`${init?.method??'GET'} ${path}`);
   assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer recipient');
   assert.equal((await readClientDefaults(home,{})).host,'https://previous.example');
   if(path==='/api/groups/research')return Response.json({group:{id:'grp_research',handle:'research',name:'Research',description:'',role:'viewer'},members:[],linked_groups:[]});
   assert.equal(path,'/api/me/preferences');assert.equal(init?.method,'PUT');assert.deepEqual(JSON.parse(String(init?.body)),{default_destination:{type:'group',id:'grp_research'}});
   return Response.json({default_destination:{type:'group',id:'grp_research'}});
  }});
  assert.equal(code,0,out.join(''));assert.deepEqual(calls,['GET /api/groups/research','PUT /api/me/preferences']);
  assert.equal((await readClientDefaults(home,{})).host,'https://groups.example');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('nonmembers and failed preference writes preserve previous host',async()=>{
 for(const failure of ['membership','preference']){
  const home=await mkdtemp(join(tmpdir(),'afbin-group-denied-'));const out:string[]=[];
  try{
   await saveTestConnection({server:'https://groups.example',token:'recipient'},home);await setClientDefault('host','https://previous.example',home,{});
   const code=await runCli(['setup','--server','https://groups.example','--group','research','--set-default','--harness','none','--json'],{home,cwd:home,env:{},interactive:false,stdout:s=>out.push(s),stderr:s=>out.push(s),fetch:async(url)=>new URL(String(url)).pathname.startsWith('/api/groups/')?Response.json({group:{id:'grp_research',handle:'research',role:failure==='membership'?null:'editor'}}):Response.json({error:'Unavailable'},{status:503})});
   assert.notEqual(code,0,out.join(''));assert.equal((await readClientDefaults(home,{})).host,'https://previous.example');
  }finally{await rm(home,{recursive:true,force:true});}
 }
});

test('destination flags reject ambiguous choices and require explicit setup defaults',()=>{
 assert.throws(()=>parseCommand(['setup','--group','research','--personal','--set-default']));
 assert.throws(()=>parseCommand(['setup','--personal']));
 assert.throws(()=>parseCommand(['setup','--service','sql','--set-default']));
 assert.throws(()=>parseCommand(['push','report.jsx','--group','research','--personal']));
 assert.equal(parseCommand(['push','report.jsx','--personal']).flags.personal,true);
 assert.equal(parseCommand(['setup','--inherit','--set-default']).flags.inherit,true);
});

test('group verification alone leaves both defaults unchanged; host-only setup authenticates without destination mutation',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-group-verify-'));const out:string[]=[];const calls:string[]=[];
 try{
  await saveTestConnection({server:'https://groups.example',token:'recipient'},home);await setClientDefault('host','https://previous.example',home,{});
  const context={home,cwd:home,env:{},interactive:false,stdout:(s:string)=>out.push(s),stderr:(s:string)=>out.push(s),fetch:async(url:Parameters<typeof fetch>[0],init?:RequestInit)=>{calls.push(`${init?.method??'GET'} ${new URL(String(url)).pathname}`);return Response.json(new URL(String(url)).pathname.includes('/groups/')?{group:{id:'grp_research',role:'viewer'}}:{default_destination:{type:'personal'}});}};
  assert.equal(await runCli(['setup','--server','https://groups.example','--group','research','--harness','none','--json'],context),0,out.join(''));
  assert.equal((await readClientDefaults(home,{})).host,'https://previous.example');
  assert.deepEqual(calls,['GET /api/groups/research']);
  assert.equal(await runCli(['setup','--server','https://groups.example','--set-default','--harness','none','--json'],context),0,out.join(''));
  assert.equal((await readClientDefaults(home,{})).host,'https://groups.example');
  assert.deepEqual(calls,['GET /api/groups/research','GET /api/me/preferences']);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('Personal and inherit explicitly update account preference without storing destination in client config',async()=>{
 for(const type of ['personal','inherit']){
  const home=await mkdtemp(join(tmpdir(),'afbin-account-default-'));const out:string[]=[];
  try{
   await saveTestConnection({server:'https://groups.example',token:'recipient'},home);
   assert.equal(await runCli(['setup','--server','https://groups.example',`--${type}`,'--set-default','--harness','none','--json'],{home,cwd:home,env:{},interactive:false,stdout:s=>out.push(s),stderr:s=>out.push(s),fetch:async(url,init)=>{
    assert.equal(new URL(String(url)).pathname,'/api/me/preferences');assert.equal(init?.method,'PUT');assert.deepEqual(JSON.parse(String(init?.body)),{default_destination:{type}});return Response.json({default_destination:{type}});
   }}),0,out.join(''));
   assert.deepEqual(await readClientDefaults(home,{}),{host:'https://groups.example'});
  }finally{await rm(home,{recursive:true,force:true});}
 }
});


test('partial local default failure explicitly reports the committed preference',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-partial-default-'));let saved=false;
 try{
  await mkdir(join(home,'.artifactbin','config.json'),{recursive:true});
  const client=new HttpClient({connection:{server:'https://groups.example',token:'recipient'},home,env:{},fetch:async(url,init)=>{
   assert.equal(new URL(String(url)).pathname,'/api/me/preferences');assert.equal(init?.method,'PUT');saved=true;return Response.json({default_destination:{type:'personal'}});
  }});
  await assert.rejects(setupDestination(client,{personal:true,setDefault:true,home,env:{}}),(error:unknown)=>{
   assert.equal((error as {code:string}).code,'setup_partial_failure');assert.match(String(error),/account destination was saved/);return true;
  });assert.equal(saved,true);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('viewer group selection succeeds, while publishing requires editor membership',async()=>{
 const client=new HttpClient({connection:{server:'https://groups.example',token:'recipient'},fetch:async()=>Response.json({group:{id:'grp_research',role:'viewer'}})});
 assert.deepEqual(await groupDestination(client,'research'),{type:'group',id:'grp_research'});
 await assert.rejects(groupDestination(client,'research',true),(error:unknown)=>{assert.equal((error as {code:string}).code,'group_editor_required');return true;});
});

test('create destination is resolved once and later Personal push edits retain existing ownership',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-group-publication-'));const calls:Array<{path:string;body:Record<string,unknown>}>=[];const out:string[]=[];let head:any;
 try{
  await saveTestConnection({server:'https://groups.example',token:'recipient'},home);await seedIdentityPool(home,home,['abc123'],'usr_one','https://groups.example');
  await writeFile(join(home,'report.jsx'),'<p id="para">One</p>');
  const context={home,cwd:home,env:{},interactive:false,stdout:(s:string)=>out.push(s),stderr:(s:string)=>out.push(s),fetch:async(url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
   const path=new URL(String(url)).pathname;const body=JSON.parse(String(init?.body??'{}'));calls.push({path,body});
   if(path==='/api/groups/research')return Response.json({group:{id:'grp_research',role:'editor'}});
   if(path==='/api/artifacts'){
    assert.deepEqual(body.destination,{type:'group',id:'grp_research'});
    head={id:'abc123',version:1,edit_id:'edit1',state:digest('first'),markup:body.markup,title:null,theme:null,template:null,visibility:'private',link_role:'viewer',parent_id:null,format:'markup',url:'https://groups.example/a/abc123'};head.document=createDocumentGraph(head.markup,1);
   }else if(path==='/api/artifacts/abc123/edits'){
    assert.equal(body.destination,undefined);const document=applyGraphPatch(head.document,head.version,body.document_update.patch);assert.ok(document);head={...head,document,markup:graphSource(document),version:2,edit_id:'edit2',state:digest('second')};
   }else throw new Error(`Unexpected ${path}`);
   return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});
  }};
  assert.equal(await runCli(['push','report.jsx','--group','research','--json'],context),0,out.join(''));
  await writeFile(join(home,'report.jsx'),(await readFile(join(home,'report.jsx'),'utf8')).replace('One','Two'));out.length=0;
  assert.equal(await runCli(['push','report.jsx','--personal','--json'],context),0,out.join(''));
  assert.deepEqual(calls.map(call=>call.path),['/api/groups/research','/api/artifacts','/api/artifacts/abc123/edits']);assert.match(head.markup,/Two/);
 }finally{await rm(home,{recursive:true,force:true});}
});


test('bundled group teaching is addressed to the selected origin and includes both preference transports',()=>{
 const text=helpDocument('groups','text','https://groups.example');
 assert.match(text,/setup --server https:\/\/groups.example --group <handle> --set-default/);
 assert.match(text,/PUT \/api\/me\/preferences/);assert.match(text,/type.*inherit/);
 assert.ok(Buffer.byteLength(text)<=8192);assert.doesNotMatch(text,/app\.artifactbin\.dev/);
});
