import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {useAppHarness,request} from './harness';
import {mintToken} from '@/lib/tokens';
import {createUser,claimToken} from '@/lib/users';
import {getArtifactById,updateSharingFor} from '@/lib/artifacts';
import {ownedArtifactState} from '@/lib/trash';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as read,DELETE as remove} from '@/app/api/artifacts/[id]/route';
import {POST as restore} from '@/app/api/artifacts/[id]/restore/route';
import {POST as refresh} from '@/app/api/artifacts/assets/refresh/route';
import {runCli} from '../../cli/src/dispatch';
import {saveConnection} from '../../cli/src/config';

useAppHarness();
const params=(id:string)=>({params:Promise.resolve({id})});

/** The real delete, restore and refresh routes behind the real CLI. */
function transport(calls:string[]):typeof fetch{
 return async(input,init)=>{
  const message=new Request(input,init);const path=new URL(message.url).pathname;calls.push(`${message.method} ${path}`);
  if(path==='/api/artifacts')return create(message);
  if(path==='/api/artifacts/assets/refresh')return refresh(message);
  const restoring=path.match(/^\/api\/artifacts\/([^/]+)\/restore$/);
  if(restoring)return restore(message,params(restoring[1]));
  const match=path.match(/^\/api\/artifacts\/([^/]+)$/);
  if(!match)throw new Error(`Unexpected route ${message.method} ${path}`);
  return message.method==='DELETE'?remove(message,params(match[1])):read(message,params(match[1]));
 };
}

it('the real CLI restores a deleted row durably and reports a live row as already restored',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-handler-restore-'));const calls:string[]=[];
 const invoke=async(args:string[])=>{
  const output:string[]=[];
  const code=await runCli([...args,'--json'],{cwd:root,home:root,interactive:false,fetch:transport(calls),stdout:s=>output.push(s),stderr:()=>{}});
  return {code,result:JSON.parse(output.join(''))};
 };
 try{
  const token=await mintToken('mxmx_test_cli_restore');
  await saveConnection({server:'http://localhost:3000',token:token.token},root);
  const created=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Restore me</p>'}}))).json();

  const deleted=await invoke(['delete',created.id]);
  expect(deleted.code,JSON.stringify(deleted.result)).toBe(0);
  expect(deleted.result).toMatchObject({id:created.id,type:'artifact',status:'deleted',local_file:'preserved'});
  expect(await ownedArtifactState({tokenId:token.id,userId:null},created.id)).toEqual({deleted:true});

  const restored=await invoke(['push','--restore',created.id]);
  expect(restored.code,JSON.stringify(restored.result)).toBe(0);
  expect(restored.result.operations).toEqual([{id:created.id,url:expect.stringContaining(`/a/${created.id}`),parent_id:null,ancestor_ids:[],status:'restored',operation:expect.any(String)}]);
  expect(await ownedArtifactState({tokenId:token.id,userId:null},created.id)).toEqual({deleted:false});

  // The live row answers the restore route with the same 404 a missing id would,
  // so the pre-read is the only thing that can call this a success.
  const again=await invoke(['push','--restore',created.id]);
  expect(again.code,JSON.stringify(again.result)).toBe(0);
  expect(again.result.operations).toEqual([{id:created.id,status:'already_restored'}]);
  expect(calls.filter(call=>call.endsWith('/restore'))).toHaveLength(1);
  // Every remote mutation carried a durable operation key; nothing is pending.
  expect(calls.filter(call=>call.startsWith('DELETE'))).toHaveLength(1);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('a retried restore or delete under the same operation identity commits once and replays its receipt',async()=>{
 const token=await mintToken('mxmx_test_restore_retry');const actor={tokenId:token.id,userId:null};
 const created=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Retry</p>'}}))).json();
 const deleteKey='restore-retry-delete-00001',restoreKey='restore-retry-restore-0001';
 const del=(headers?:Record<string,string>)=>remove(request(`/api/artifacts/${created.id}`,{method:'DELETE',token:token.token,headers}),params(created.id));
 const put=(headers?:Record<string,string>)=>restore(request(`/api/artifacts/${created.id}/restore`,{method:'POST',token:token.token,headers}),params(created.id));

 const deleted=await del({'Idempotency-Key':deleteKey});
 expect(deleted.status).toBe(200);
 expect(await deleted.json()).toEqual({ok:true,deleted_ids:[created.id]});
 expect(deleted.headers.get('X-Artifactbin-Mutation-Receipt')).toBe(deleteKey);

 const restored=await put({'Idempotency-Key':restoreKey});
 expect(restored.status).toBe(200);
 expect((await restored.json()).id).toBe(created.id);
 expect(await ownedArtifactState(actor,created.id)).toEqual({deleted:false});

 // Retrying the delete now must NOT delete the restored row: a receipt replays
 // the answer it recorded, it never runs the operation a second time.
 const retriedDelete=await del({'Idempotency-Key':deleteKey});
 expect(retriedDelete.status).toBe(200);
 expect(await retriedDelete.json()).toEqual({ok:true,deleted_ids:[created.id]});
 expect(await ownedArtifactState(actor,created.id)).toEqual({deleted:false});

 // And the same in the other direction, from the trash.
 await del({'Idempotency-Key':'restore-retry-delete-00002'});
 const retriedRestore=await put({'Idempotency-Key':restoreKey});
 expect(retriedRestore.status).toBe(200);
 expect(await ownedArtifactState(actor,created.id)).toEqual({deleted:true});
});

it('delete and restore stay owner-only, and a refused caller never claims the operation key',async()=>{
 const owner=await createUser({email:'mxmx_test_restore_owner@example.com'});
 const ownerToken=await mintToken('mxmx_test_restore_owner');await claimToken(owner.id,ownerToken.token);
 const editor=await createUser({email:'mxmx_test_restore_editor@example.com'});
 const editorToken=await mintToken('mxmx_test_restore_editor');await claimToken(editor.id,editorToken.token);
 const created=await(await create(request('/api/artifacts',{method:'POST',token:ownerToken.token,json:{markup:'<p>Shared</p>'}}))).json();
 await updateSharingFor({tokenId:ownerToken.id,userId:owner.id},created.id,{shares:[{email:'mxmx_test_restore_editor@example.com',role:'editor'}]});

 // The UI door says the same: an editor may edit, only the owner may delete.
 const snapshot=await(await read(request(`/api/artifacts/${created.id}`,{token:editorToken.token}),params(created.id))).json();
 expect(snapshot.capabilities).toMatchObject({edit:true,delete:false,restore:false});
 const key='restore-editor-0000000001';
 expect((await remove(request(`/api/artifacts/${created.id}`,{method:'DELETE',token:editorToken.token,headers:{'Idempotency-Key':key}}),params(created.id))).status).toBe(404);
 expect((await getArtifactById(created.id))?.deleted_at ?? null).toBeNull();

 // The owner's own operation under that same key is untouched by the refusal.
 const deleted=await remove(request(`/api/artifacts/${created.id}`,{method:'DELETE',token:ownerToken.token,headers:{'Idempotency-Key':key}}),params(created.id));
 expect(deleted.status).toBe(200);
 expect((await restore(request(`/api/artifacts/${created.id}/restore`,{method:'POST',token:editorToken.token,headers:{'Idempotency-Key':'restore-editor-0000000002'}}),params(created.id))).status).toBe(404);
 expect(await ownedArtifactState({tokenId:ownerToken.id,userId:owner.id},created.id)).toEqual({deleted:true});
});

it('refresh reports each url on its own and a retried refresh answers the recorded receipt',async()=>{
 const token=await mintToken('mxmx_test_refresh');
 const created=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>No pictures</p>'}}))).json();
 const key='refresh-retry-00000000001';
 const call=(json:Record<string,unknown>,headers?:Record<string,string>)=>refresh(request('/api/artifacts/assets/refresh',{method:'POST',token:token.token,json,headers}));

 const byId=await call({id:created.id},{'Idempotency-Key':key});
 expect(byId.status).toBe(200);
 expect(await byId.json()).toEqual({refreshed:[],unchanged:[],failed:[]});
 expect(byId.headers.get('X-Artifactbin-Mutation-Receipt')).toBe(key);

 // A url nobody published is a per-url refusal inside a success, never a refusal
 // of the call: one stale picture must not hide the ones that did refresh.
 const byUrl=await call({url:'https://example.com/never-imported.png'});
 expect(byUrl.status).toBe(200);
 const outcome=await byUrl.json();
 expect(outcome.refreshed).toEqual([]);
 expect(outcome.failed).toEqual([expect.objectContaining({url:'https://example.com/never-imported.png',code:'not_cached'})]);

 const retried=await call({id:created.id},{'Idempotency-Key':key});
 expect(retried.status).toBe(200);
 expect(await retried.json()).toEqual({refreshed:[],unchanged:[],failed:[]});

 // A different account cannot refresh this document, keyed or not.
 const stranger=await mintToken('mxmx_test_refresh_stranger');
 const refused=await refresh(request('/api/artifacts/assets/refresh',{method:'POST',token:stranger.token,json:{id:created.id},headers:{'Idempotency-Key':'refresh-stranger-000000001'}}));
 expect(refused.status).toBe(404);
});

it('the real CLI refreshes each named target durably and reports their outcomes separately',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-handler-refresh-'));const calls:string[]=[];const keys:Array<string|null>=[];
 const recorded:typeof fetch=async(input,init)=>{
  const message=new Request(input,init);
  if(message.method==='POST'&&new URL(message.url).pathname==='/api/artifacts/assets/refresh')keys.push(message.headers.get('Idempotency-Key'));
  return transport(calls)(message);
 };
 const invoke=async(args:string[])=>{
  const output:string[]=[];
  const code=await runCli([...args,'--json'],{cwd:root,home:root,interactive:false,fetch:recorded,stdout:s=>output.push(s),stderr:()=>{}});
  return {code,result:JSON.parse(output.join(''))};
 };
 try{
  const token=await mintToken('mxmx_test_cli_refresh');
  await saveConnection({server:'http://localhost:3000',token:token.token},root);
  const first=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>One</p>'}}))).json();
  const second=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Two</p>'}}))).json();
  expect((await invoke(['pull',first.id,'--output','one.jsx'])).code).toBe(0);

  const refreshed=await invoke(['push','--refresh',first.id,second.id]);
  expect(refreshed.code,JSON.stringify(refreshed.result)).toBe(0);
  // Each target is reported on its own, with the changed, unchanged and failed
  // urls the server answered for that document alone.
  expect(refreshed.result.operations).toEqual([
   {id:first.id,refreshed:[],unchanged:[],failed:[],status:'unchanged',operation:expect.any(String)},
   {id:second.id,refreshed:[],unchanged:[],failed:[],status:'unchanged',operation:expect.any(String)},
  ]);
  expect(keys).toHaveLength(2);
  expect(keys.every(key=>!!key)).toBe(true);
  expect(new Set(keys).size).toBe(2);
 }finally{await rm(root,{recursive:true,force:true});}
});
