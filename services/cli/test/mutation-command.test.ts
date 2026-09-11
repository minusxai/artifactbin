import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';
import {digest} from '../src/files';

test('a lost mutation reply resumes the frozen operation with the same identity and rejects changed input',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-write-recovery-'));const keys:string[]=[];let lose=true;
 const invoke=async()=>{const out:string[]=[];const code=await runCli(['query','abc123','--write','--input','change.sql','--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(input,init)=>{
  if(init?.method==='POST'){keys.push(new Headers(init.headers).get('Idempotency-Key')!);if(lose){lose=false;throw Error('reply lost');}return Response.json({id:'abc123',version:2,affected:1,rowCount:2},{headers:{'X-Artifactbin-Account':'account'}});}
  assert.match(String(input),/artifacts\/abc123$/);return Response.json({id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'dataset',access:'readwrite',capabilities:{edit:true,mutation_receipts:true}},{headers:{'X-Artifactbin-Account':'account'}});
 }});return {code,result:JSON.parse(out.join(''))};};
 try{
  await saveConnection({server:'https://example.com',token:'test'},root);await writeFile(join(root,'change.sql'),'insert into public.rows (n) values (2)');
  const first=await invoke();assert.equal(first.result.error.code,'outcome_unknown');assert.ok(keys[0]);
  const pending=await readFile(join(root,'.artifactbin','pending-operation.json'),'utf8');assert.ok(!pending.includes('"token":"test"'));
  await writeFile(join(root,'change.sql'),'delete from public.rows');const changed=await invoke();assert.equal(changed.result.error.code,'pending_recovery');assert.equal(keys.length,1);
  await writeFile(join(root,'change.sql'),'insert into public.rows (n) values (2)');const retry=await invoke();assert.equal(retry.code,0,JSON.stringify(retry));assert.deepEqual(keys,[keys[0],keys[0]]);assert.equal(retry.result.affected,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
