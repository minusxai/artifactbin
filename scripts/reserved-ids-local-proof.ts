/** CI proof against the actual CLI registration module in independent processes. */
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {State,HOME_SCOPE} from '../services/cli/src/state';
import {HttpClient} from '../services/cli/src/http';
import {loadWorkspace} from '../services/cli/src/workspace';
import {addFiles} from '../services/cli/src/identities';
const origin='http://127.0.0.1:7445',account='local-proof';
if(process.argv[2]){
 const root=process.argv[2],worker=process.argv[3];
 const client=new HttpClient({connection:{server:origin,token:'mxmx_test_unused'},account,home:root,fetch:async()=>{throw Error('offline');}});
 const ids:string[]=[];
 for(let i=0;i<10;i++){
  const file=`worker-${worker}-${i}.csv`;await writeFile(join(root,file),'value\n1\n');
  try{ids.push((await addFiles(await loadWorkspace(root,root),[file],client))[file]!);}
  catch(error){if(!(error instanceof Error)||!error.message.includes('offline'))throw error;}
 }
 console.log(JSON.stringify(ids));
}else{
 const root=await realpath(await mkdtemp(join(tmpdir(),'identity-process-proof-')));
 try{
  const state=await State.open(root);state.put(root,'workspace',root,{server:origin,account});
  state.put(HOME_SCOPE,'identity-pool',JSON.stringify([origin,account]),{ids:Array.from({length:100},(_,i)=>'L'+String(i).padStart(5,'0'))});state.close();
  const replies=await Promise.all(Array.from({length:12},(_,i)=>promisify(execFile)(process.execPath,['--import','tsx',fileURLToPath(import.meta.url),root,String(i)],{maxBuffer:1024*1024})));
  const ids=replies.flatMap(reply=>JSON.parse(reply.stdout));assert.equal(ids.length,100);assert.equal(new Set(ids).size,100);
  const reopened=await State.open(root);assert.equal(reopened.list(root,'draft-identity').length,100);
  assert.deepEqual(reopened.get<{ids:string[]}>(HOME_SCOPE,'identity-pool',JSON.stringify([origin,account]))!.value.ids,[]);reopened.close();
  console.log('PASS actual registration: 12 processes, 100 unique identities, 20 offline refusals, durable mappings after reopen');
 }finally{await rm(root,{recursive:true,force:true});}
}
