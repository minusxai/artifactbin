import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import {isAbsolute,join,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {parse,stringify} from 'yaml';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';
import {digest} from '../src/files';
import {State} from '../src/state';
test('profile YAML pulls, edits, recovers a lost reply and subsequently pushes offline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-account-workflow-'));
 const home=await mkdtemp(join(tmpdir(),'afbin-account-workflow-home-'));
 try{
  await saveConnection({server:'https://example.com',token:'test-token'},home);
  let profile={type:'profile',id:'usr_example',state:'a'.repeat(64),username:'old',email:'mxmx_test_profile@example.com',name:null,liked:[],following:[]};
  let lose=true,writes=0;const receipts=new Map<string,unknown>();
  const transport:typeof fetch=async(input,init)=>{
   assert.equal(new URL(String(input)).pathname,'/api/account/profile');
   if(init?.method==='PATCH'){
    const key=(init.headers as Record<string,string>)['Idempotency-Key'];assert.ok(key);
    if(!receipts.has(key)){writes++;profile={...JSON.parse(String(init.body)),state:'b'.repeat(64)};receipts.set(key,profile);}
    if(lose){lose=false;throw Error('lost reply');}
    return Response.json(receipts.get(key),{headers:{'X-Artifactbin-Account':'usr_example'}});
   }
   return Response.json(profile,{headers:{'X-Artifactbin-Account':'usr_example'}});
  };
  const invoke=async(args:string[],fetcher=transport)=>{const out:string[]=[];const code=await runCli([...args,'--server','https://example.com','--json'],{cwd:root,home,env:{},stdout:s=>out.push(s),stderr:()=>{},fetch:fetcher});return {code,result:JSON.parse(out.join(''))};};
  const pulled=await invoke(['pull','--type','PROFILE','--output','profile.yaml']);assert.equal(pulled.code,0,JSON.stringify(pulled));
  const path=join(root,'profile.yaml');const file=parse(await readFile(path,'utf8'));file.username='new';await writeFile(path,stringify(file));
  assert.equal((await invoke(['push','profile.yaml'])).result.error.code,'outcome_unknown');
  const recovered=await invoke(['push','profile.yaml']);assert.equal(recovered.code,0,JSON.stringify(recovered));assert.equal(writes,1);assert.equal(parse(await readFile(path,'utf8')).username,'new');
  const offline=await invoke(['push','profile.yaml'],async()=>{throw Error('unchanged push must stay offline');});assert.equal(offline.code,0,JSON.stringify(offline));
  const status=await invoke(['status','--type','profile'],async()=>{throw Error('status must stay offline');});assert.equal(status.code,0,JSON.stringify(status));assert.equal(status.result.files[0].status,'unchanged');
 }finally{await rm(root,{recursive:true,force:true});await rm(home,{recursive:true,force:true});}
});

// ---- Seeded by the orchestrator for workstream W2b (cli-account-docs). Turn into a passing, non-todo test. ----
test('account resource tracking lives in the state store as account records plus the workspace binding, never accounts.json',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-account-store-'));
 const home=await mkdtemp(join(tmpdir(),'afbin-account-home-'));
 try{
  await saveConnection({server:'https://example.com',token:'test-token'},home);
  const profile={type:'profile',id:'usr_example',state:'a'.repeat(64),username:'remote',email:'mxmx_test_store@example.com',name:null,liked:[],following:[]};
  const transport:typeof fetch=async()=>Response.json(profile,{headers:{'X-Artifactbin-Account':'usr_example'}});
  const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--server','https://example.com','--json'],{cwd:root,home,env:{},stdout:s=>out.push(s),stderr:()=>{},fetch:transport});return {code,result:JSON.parse(out.join(''))};};
  const pulled=await invoke(['pull','--type','profile','--output','profile.yaml']);
  assert.equal(pulled.code,0,JSON.stringify(pulled));
  // The workspace holds the user's file and nothing else: no accounts.json, no tracking directory.
  assert.deepEqual(await readdir(root),['profile.yaml']);
  const scope=await realpath(root);const state=await State.open(home);
  try{
   assert.deepEqual(state.get(scope,'workspace',scope)?.value,{server:'https://example.com',account:'usr_example'});
   const record=state.get<{resource:{type:string;id:string};sha256:string}>(scope,'account','profile.yaml');
   assert.equal(record?.value.resource.id,'usr_example');assert.equal(record?.value.resource.type,'profile');
   assert.equal(record?.value.sha256,digest(await readFile(join(root,'profile.yaml'))),'the record hashes the YAML it accepted, it does not keep a copy of it');
   assert.deepEqual(state.list(scope,'account').map(entry=>entry.key),['profile.yaml']);
  }finally{state.close();}
  const status=await invoke(['status','--type','profile']);
  assert.equal(status.result.files[0].status,'unchanged',JSON.stringify(status));
  const edited=stringify({...profile,username:'local-edit'});await writeFile(join(root,'profile.yaml'),edited);
  assert.equal((await invoke(['status','--type','profile'])).result.files[0].status,'modified');
  const forced=await invoke(['pull','--type','profile','--force']);
  assert.equal(forced.code,0,JSON.stringify(forced));
  const backup=forced.result.operations[0].backup as string;
  assert.ok(isAbsolute(backup)&&backup.startsWith(join(home,'.artifactbin','backups','local')+sep),backup);
  assert.equal(await readFile(backup,'utf8'),edited,'the discarded local edit is recoverable outside the workspace');
  assert.deepEqual(await readdir(root),['profile.yaml']);
 }finally{await rm(root,{recursive:true,force:true});await rm(home,{recursive:true,force:true});}
});
