import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';
import {digest} from '../src/files';
import {parseResourceFile} from '../src/resource-file';

test('YAML pull round-trips authorized governance and separate data, preserving local edits against an unchanged head',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-resource-pull-'));let contentReads=0;
 const head={id:'data123',format:'dataset',version:1,edit_id:'one',state:digest('one'),title:'Sales',access:'readwrite',shares:[{email:'reader@example.com',role:'viewer'}],dataset_policy:null,policy_revision:0};
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(input)=>{
  if(new URL(String(input)).pathname.endsWith('/content')){contentReads++;return Response.json([{score:42}]);}
  return Response.json(head,{headers:{'X-Artifactbin-Account':'account'}});
 }});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveConnection({server:'https://example.com',token:'test'},root);
  const pulled=await invoke(['pull','data123','--format','YAML','--output','sales.yaml']);assert.equal(pulled.code,0,JSON.stringify(pulled.result));
  const file=parseResourceFile(await readFile(join(root,'sales.yaml'),'utf8'));assert.equal(file.type,'dataset');if(file.type!=='dataset')assert.fail();assert.equal(file.access,'readwrite');assert.equal(file.policy_revision,0);assert.deepEqual(file.shares,head.shares);assert.equal(file.source,'./sales.json');
  assert.deepEqual(JSON.parse(await readFile(join(root,'sales.json'),'utf8')),[{score:42}]);
  await writeFile(join(root,'sales.json'),'[{"score":43}]\n');await writeFile(join(root,'sales.yaml'),(await readFile(join(root,'sales.yaml'),'utf8')).replace('Sales','My sales'));
  const refreshed=await invoke(['pull','sales.yaml']);assert.equal(refreshed.code,0,JSON.stringify(refreshed.result));assert.equal(contentReads,1,'unchanged immutable content uses its saved bytes');
  assert.equal(parseResourceFile(await readFile(join(root,'sales.yaml'),'utf8')).title,'My sales');assert.deepEqual(JSON.parse(await readFile(join(root,'sales.json'),'utf8')),[{score:43}]);
  const lock=JSON.parse(await readFile(join(root,'afbin.lock'),'utf8'));assert.deepEqual(Object.keys(lock.files),['sales.yaml']);assert.deepEqual(JSON.parse(Buffer.from(lock.files['sales.yaml'].source.bytes,'base64').toString()),[{score:42}]);
  head.version=2;head.state=digest('two');head.edit_id='two';
  assert.equal((await invoke(['pull','sales.yaml'])).result.error.code,'merge_conflict');
  const forced=await invoke(['pull','sales.yaml','--force']);assert.equal(forced.code,0,JSON.stringify(forced.result));
  assert.deepEqual(JSON.parse(await readFile(join(root,'sales.json'),'utf8')),[{score:42}]);
  const backup=forced.result.operations[0].source_backups[0];assert.deepEqual(JSON.parse(await readFile(join(root,backup),'utf8')),[{score:43}]);
 }finally{await rm(root,{recursive:true,force:true});}
});
