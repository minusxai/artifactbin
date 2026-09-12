import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parse,stringify} from 'yaml';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';
test('profile YAML pulls, edits, recovers a lost reply and subsequently pushes offline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-account-workflow-'));
 try{
  await saveConnection({server:'https://example.com',token:'test-token'},root);
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
  const invoke=async(args:string[],fetcher=transport)=>{const out:string[]=[];const code=await runCli([...args,'--server','https://example.com','--json'],{cwd:root,home:root,env:{},stdout:s=>out.push(s),stderr:()=>{},fetch:fetcher});return {code,result:JSON.parse(out.join(''))};};
  const pulled=await invoke(['pull','--type','PROFILE','--output','profile.yaml']);assert.equal(pulled.code,0,JSON.stringify(pulled));
  const path=join(root,'profile.yaml');const file=parse(await readFile(path,'utf8'));file.username='new';await writeFile(path,stringify(file));
  assert.equal((await invoke(['push','profile.yaml'])).result.error.code,'outcome_unknown');
  const recovered=await invoke(['push','profile.yaml']);assert.equal(recovered.code,0,JSON.stringify(recovered));assert.equal(writes,1);assert.equal(parse(await readFile(path,'utf8')).username,'new');
  const offline=await invoke(['push','profile.yaml'],async()=>{throw Error('unchanged push must stay offline');});assert.equal(offline.code,0,JSON.stringify(offline));
  const status=await invoke(['status','--type','profile'],async()=>{throw Error('status must stay offline');});assert.equal(status.code,0,JSON.stringify(status));assert.equal(status.result.files[0].status,'unchanged');
 }finally{await rm(root,{recursive:true,force:true});}
});

// ---- Seeded by the orchestrator for workstream W2b (cli-account-docs). Turn into a passing, non-todo test. ----
test('account resource tracking lives in the state store as account records plus the workspace binding, never accounts.json',{todo:true},async()=>{
 // Pull the profile into an isolated workspace; assert readdir(root) is ['profile.yaml'], State has {server,account} under kind
 // 'workspace' and {resource,sha256} under kind 'account' keyed 'profile.yaml', and a forced pull that overwrites a local edit
 // reports an absolute backup path under <home>/.artifactbin/backups/local/.
 assert.fail('implement');
});
