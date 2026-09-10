import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';
import {digest} from '../src/files';
test('retrying a lost folder-delete reply forgets every deleted identity while preserving local files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-delete-retry-'));let deletes=0;
 const invoke=async(args:string[])=>{const output:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async(input,init)=>{
  if(init?.method==='DELETE'){deletes++;if(deletes===1)throw new Error('deleted, but reply lost');return Response.json({ok:true,deleted_ids:['abc123','def456']},{headers:{'X-Artifactbin-Account':'usr_one'}});}
  const id=new URL(String(input)).pathname.split('/').at(-1)!;
  return Response.json({id,version:1,edit_id:'one',state:digest(id),format:id==='abc123'?'folder':'markup',markup:id==='abc123'?'':'<p>Child</p>'},{headers:{'X-Artifactbin-Account':'usr_one'}});
 }});return{code,result:JSON.parse(output.join(''))};};
 try{
  await saveConnection({server:'https://example.com',token:'mx_test'},root);
  assert.equal((await invoke(['pull','abc123','folder.jsx'])).code,0);assert.equal((await invoke(['pull','def456','child.jsx'])).code,0);
  const folder=await readFile(join(root,'folder.jsx'));const child=await readFile(join(root,'child.jsx'));
  assert.notEqual((await invoke(['delete','folder.jsx'])).code,0);
  assert.equal(Object.keys(JSON.parse(await readFile(join(root,'afbin.lock'),'utf8')).files).length,2);
  const retried=await invoke(['delete','folder.jsx']);assert.equal(retried.code,0,JSON.stringify(retried.result));assert.equal(deletes,2);
  assert.deepEqual(JSON.parse(await readFile(join(root,'afbin.lock'),'utf8')).files,{});
  assert.deepEqual(await readFile(join(root,'folder.jsx')),folder);assert.deepEqual(await readFile(join(root,'child.jsx')),child);
 }finally{await rm(root,{recursive:true,force:true});}
});
