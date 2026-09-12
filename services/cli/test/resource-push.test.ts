import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';
import {digest} from '../src/files';
import {parseResourceFile} from '../src/resource-file';
import {baselineOf,loadWorkspace} from '../src/workspace';
import {tracking} from './tracking';

test('YAML dataset push publishes content and access together, tracks source bytes and skips unchanged work offline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-resource-push-'));let requests=0,version=0;const writes:Record<string,unknown>[]=[];
 let head:Record<string,unknown>={};
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(_input,init)=>{
  requests++;
  if(init?.method!=='GET'){
   const body=JSON.parse(String(init?.body));writes.push(body);version++;
   head={...head,id:'data123',format:'dataset',edit_id:`edit${version}`,version,state:digest(`state${version}`),access:body.access??head.access,shares:body.shares??head.shares,title:body.title??head.title,rows:[{score:version===1?42:43}]};
  }
  return Response.json(head,{headers:{'X-Artifactbin-Account':'account'}});
 }});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveConnection({server:'https://example.com',token:'test'},root);
  await writeFile(join(root,'sales.csv'),'score\n42\n');await writeFile(join(root,'sales.yaml'),'type: dataset\nsource: ./sales.csv\naccess: readwrite\nshares: []\n');
  const first=await invoke(['push','sales.yaml']);assert.equal(first.code,0,JSON.stringify(first.result));assert.equal(writes[0].dataset,'score\n42\n');assert.equal(writes[0].access,'readwrite');
  const resource=parseResourceFile(await readFile(join(root,'sales.yaml'),'utf8'));assert.equal(resource.id,'data123');
  const count=requests;assert.equal((await invoke(['push'])).code,0);assert.equal(requests,count);
  await writeFile(join(root,'sales.csv'),'score\n43\n');assert.equal((await invoke(['status'])).result.files[0].status,'modified');
  const diff=await invoke(['diff']);assert.equal(diff.code,0);assert.equal(diff.result.diffs[0].path,'sales.csv');assert.match(diff.result.diffs[0].diff,/\+43/);
  const changed=await invoke(['push']);assert.equal(changed.code,0,JSON.stringify(changed.result));assert.equal(writes[1].dataset,'score\n43\n');
  const finalCount=requests;assert.equal((await invoke(['push'])).code,0);assert.equal(requests,finalCount);
  assert.deepEqual(Object.keys((await tracking(root,root)).files),['sales.yaml']);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('resource edits made during publication retain new settings while acknowledging the confirmed source',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-resource-flight-'));
 try{
  await saveConnection({server:'https://example.com',token:'test'},root);
  await writeFile(join(root,'sales.csv'),'score\n42\n');await writeFile(join(root,'sales.yaml'),'type: dataset\nsource: ./sales.csv\ntitle: Before\n');
  const out:string[]=[];
  const code=await runCli(['push','sales.yaml','--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async()=>{
   await writeFile(join(root,'sales.yaml'),'type: dataset\nsource: ./sales.csv\ntitle: While publishing\n');
   return Response.json({id:'data123',format:'dataset',title:'Before',version:1,edit_id:'one',state:digest('one')},{headers:{'X-Artifactbin-Account':'account'}});
  }});
  assert.equal(code,0,out.join(''));const local=parseResourceFile(await readFile(join(root,'sales.yaml'),'utf8'));assert.equal(local.id,'data123');assert.equal(local.title,'While publishing');
  const workspace=await loadWorkspace(root,root);const entry=workspace.tracking!.files['sales.yaml'];
  assert.equal(parseResourceFile((await baselineOf(workspace,'sales.yaml',entry))!.toString()).title,'Before');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('YAML metadata push reconciles an unrelated remote field before its conditional write',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-resource-remote-'));let head:Record<string,unknown>={},writes=0;
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(_input,init)=>{
  if(init?.method==='POST'){head={id:'data123',format:'dataset',title:'Before',description:'Before',version:1,edit_id:'one',state:digest('one')};}
  if(init?.method==='PATCH'){
   writes++;const body=JSON.parse(String(init.body));if(body.expectedState!==head.state)return Response.json({error:'state_conflict'},{status:409});assert.equal(body.title,'Local title');assert.equal(body.description,undefined);head={...head,title:body.title,state:digest('three')};
  }
  return Response.json(head,{headers:{'X-Artifactbin-Account':'account'}});
 }});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveConnection({server:'https://example.com',token:'test'},root);await writeFile(join(root,'sales.csv'),'score\n42\n');await writeFile(join(root,'sales.yaml'),'type: dataset\nsource: ./sales.csv\ntitle: Before\n');
  assert.equal((await invoke(['push','sales.yaml'])).code,0);
  await writeFile(join(root,'sales.yaml'),(await readFile(join(root,'sales.yaml'),'utf8')).replace('title: Before','title: Local title'));
  head={...head,description:'Remote description',version:2,edit_id:'two',state:digest('two')};
  const result=await invoke(['push','sales.yaml']);assert.equal(result.code,0,JSON.stringify(result.result));assert.equal(writes,1);assert.equal(parseResourceFile(await readFile(join(root,'sales.yaml'),'utf8')).description,'Remote description');
  assert.equal((await tracking(root,root)).files['sales.yaml'].source!.version,1,'metadata acknowledgement must not relabel old data as the new content version');
  await writeFile(join(root,'sales.csv'),'score\n43\n');assert.equal((await invoke(['push','sales.yaml'])).result.error.code,'merge_conflict');
 }finally{await rm(root,{recursive:true,force:true});}
});
