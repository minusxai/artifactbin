import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseResourceFile,reconcileResource} from '../src/resource-file';
import {runCli} from '../src/dispatch';

test('typed YAML normalizes fixed enums and preserves exact identity, paths and policy data',()=>{
 const file=parseResourceFile('type: DATASET\nid: AbC123\nsource: ./Sales.CSV\naccess: ReadWrite\nvisibility: PRIVATE\nshares:\n  - email: USER@example.com\n    role: Editor\npolicy:\n  version: 1\n  enforcement: enabled\n  tables: []\n  execution:\n    generation:\n      models: [DeepSeek-V4]\n      max_calls: 1\n      max_tokens: 100\n');
 assert.equal(file.type,'dataset');assert.equal(file.id,'AbC123');assert.equal(file.visibility,'private');
 if(file.type!=='dataset')assert.fail('dataset expected');
 assert.equal(file.source,'./Sales.CSV');assert.equal(file.access,'readwrite');assert.deepEqual(file.shares,[{email:'user@example.com',role:'editor'}]);
 assert.deepEqual(file.policy?.execution?.generation?.models,['DeepSeek-V4']);
});

test('native validate checks YAML and source bytes offline before setup, including source confinement',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-resource-validation-'));
 const invoke=async()=>{const out:string[]=[];const code=await runCli(['validate','sales.yaml','--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async()=>{assert.fail('local resource validation must not authenticate or fetch');}});return{code,result:JSON.parse(out.join(''))};};
 try{
  await writeFile(join(root,'Sales.CSV'),'Name,score\nTest,42\n');
  await writeFile(join(root,'sales.yaml'),'type: DATASET\nsource: ./Sales.CSV\naccess: ReadWrite\n');
  const good=await invoke();assert.equal(good.code,0,JSON.stringify(good.result));assert.equal(good.result.valid,true);
  await writeFile(join(root,'sales.yaml'),'type: dataset\nsource: ../outside.csv\n');
  assert.notEqual((await invoke()).code,0);
  await writeFile(join(root,'sales.yaml'),'type: dataset\nsource: ./missing.csv\n');
  assert.notEqual((await invoke()).code,0);
  await writeFile(join(root,'sales.yaml'),'type: dataset\nsource: ./Sales.CSV\n');
  await writeFile(join(root,'Sales.CSV'),'');assert.notEqual((await invoke()).code,0);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('omitted settings stay omitted and explicit permission clearing stays explicit',()=>{
 assert.deepEqual(parseResourceFile('type: folder\ntitle: Reports\n'),{type:'folder',title:'Reports'});
 assert.deepEqual(parseResourceFile('type: dataset\nshares: []\npolicy: null\npolicy_revision: 2\n'),{type:'dataset',shares:[],policy:null,policy_revision:2});
});

test('resource reconciliation merges independent settings and never unions divergent permission lists',()=>{
 const base=parseResourceFile('type: dataset\ntitle: Original\ndescription: Original\nshares: []\n');
 const local={...base,title:'Local',shares:[{email:'a@example.com',role:'viewer' as const}]};
 const remote={...base,description:'Remote'};
 const merged=reconcileResource(base,local,remote);assert.equal(merged.ok,true);if(merged.ok)assert.deepEqual(merged.resource,{...remote,title:'Local',shares:local.shares});
 const conflict=reconcileResource(base,local,{...remote,shares:[{email:'b@example.com',role:'viewer'}]});assert.deepEqual(conflict,{ok:false,fields:['shares']});
 assert.deepEqual(reconcileResource(base,{type:'dataset'},remote),{ok:true,resource:remote});
});

test('typed YAML rejects unknown fields, ambiguous YAML, invalid paths and fields for another resource',()=>{
 for(const input of [
  'type: dataset\nType: dataset', 'type: folder\nsource: ./rows.csv',
  'type: file\naccess: readwrite', 'type: dataset\npolicy_revision: -1',
  'type: dataset\nsource: https://example.com/rows.csv', 'type: dataset\nsource: /etc/passwd',
  'type: dataset\ntitle: &title Test',
  'type: dataset\naccess: read\naccess: readwrite', 'type: Dataset\nshares: [someone@example.com]',
  'type: dataset\npolicy:\n  version: 1\n  role: owner', 'type: unknown',
 ])assert.throws(()=>parseResourceFile(input),input);
});
