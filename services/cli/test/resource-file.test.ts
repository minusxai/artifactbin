import {test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseResourceFile,reconcileResource} from '../src/resource-file';
import {runCli} from '../src/dispatch';
import {validateFiles} from '../src/validation';
import {loadWorkspace} from '../src/workspace';
import {cliHarness} from './harness';


test('typed YAML normalizes fixed enums and preserves exact identity, paths and policy data',()=>{
 const file=parseResourceFile('type: DATASET\nid: AbC123\nsource: ./Sales.CSV\naccess: ReadWrite\nvisibility: PRIVATE\nshares:\n  - email: USER@example.com\n    role: Editor\npolicy:\n  version: 1\n  enforcement: enabled\n  tables: []\n  execution:\n    generation:\n      models: [DeepSeek-V4]\n      max_calls: 1\n      max_tokens: 100\n');
 assert.equal(file.type,'dataset');assert.equal(file.id,'AbC123');assert.equal(file.visibility,'private');
 if(file.type!=='dataset')assert.fail('dataset expected');
 assert.equal(file.source,'./Sales.CSV');assert.equal(file.access,'readwrite');assert.deepEqual(file.shares,[{email:'user@example.com',role:'editor'}]);
 assert.deepEqual(file.policy?.execution?.generation?.models,['DeepSeek-V4']);
});

test('native validate checks YAML and source bytes offline before authentication, including source confinement',async()=>{
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

describe('validating local files', () => {
  test('validates local dependency paths and fixes tags without network or state creation',async()=>{
   const base=await mkdtemp(join(tmpdir(),'afbin-validate-'));const home=join(base,'home'),root=join(base,'work');await mkdir(home);await mkdir(root);const originalFetch=globalThis.fetch;
   globalThis.fetch=async()=>assert.fail('local validation made a network request');
   try{
    await writeFile(join(root,'data.csv'),'n\n1\n');
    const body='<Helmet><Query  name = "q" source = "./data.csv">{`select n from public.rows`}</Query></Helmet><Table data="$q" />';
    await writeFile(join(root,'doc.jsx'),body);
    const workspace=await loadWorkspace(root,home);
    assert.equal((await validateFiles(workspace,['doc.jsx'])).valid,true);
    assert.equal(await readFile(join(root,'doc.jsx'),'utf8'),body);
    const fixed=await validateFiles(workspace,['doc.jsx'],true);assert.equal(fixed.valid,true);assert.equal(fixed.files[0].fixed,true);
    assert.ok((await readFile(join(root,'doc.jsx'),'utf8')).includes('source="./data.csv"'));
    assert.deepEqual((await readdir(root)).sort(),['data.csv','doc.jsx'],'validation writes nothing into the workspace');
    await writeFile(join(root,'bad.jsx'),'<Bogus />');assert.equal((await validateFiles(workspace,['bad.jsx'])).valid,false);
    await writeFile(join(root,'missing.jsx'),'<img src="./missing.png" />');assert.equal((await validateFiles(workspace,['missing.jsx'])).valid,false);
   }finally{globalThis.fetch=originalFetch;await rm(base,{recursive:true,force:true});}
  });
});

describe('validate --remote', () => {
  const harness=(prefix:string)=>cliHarness(prefix,{flags:['--json','--server','https://example.com']});

  test('validate --remote adds read-only server checks and never mutates or refreshes credentials',async()=>{
   const h=await harness('afbin-seed-validate-remote-');
   try{
    await writeFile(join(h.root,'report.jsx'),'---\nid: abc123\n---\n<p>Hi</p>\n');
    const head={id:'abc123',version:1,edit_id:'e1',state:'a'.repeat(64),format:'markup',markup:'<p>Old</p>',capabilities:{read:true,edit:true}};
    const code=await h.invoke(['validate','report.jsx','--remote'],({method,path})=>method==='POST'&&path==='/api/artifacts/preflight'?Response.json({...head,dry_run:true}):method==='GET'?Response.json(head):Response.json({error:'unexpected'},{status:500}));
    assert.equal(code,0,h.out.join(''));assert.equal(h.last().valid,true);assert.ok(h.calls.every(c=>c.method==='GET'||c.path==='/api/artifacts/preflight'),'only reads and the preflight');
   }finally{await h.cleanup();}
  });
});
