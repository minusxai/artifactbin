/**
 * Document lifecycle through the REAL handlers: restore from trash, preconditions on a stale edit,
 * atomic replacement beside a concurrent edit, and paged listing.
 */

import { expect, it } from 'vitest';
import { useAppHarness, request } from './harness';
import { cliWorkspace } from './cli-harness';
import { mintToken } from '@/lib/tokens';
import { createUser, claimToken } from '@/lib/users';
import { getArtifactById, updateSharingFor, createArtifact, replaceArtifactFor } from '@/lib/artifacts';
import { ownedArtifactState } from '@/lib/trash';
import { POST as create, GET as list } from '@/app/api/artifacts/route';
import { GET as read, DELETE as remove, PUT as replace } from '@/app/api/artifacts/[id]/route';
import { POST as restore } from '@/app/api/artifacts/[id]/restore/route';
import { POST as refresh } from '@/app/api/artifacts/assets/refresh/route';
import { readRecord } from '../../cli/test/tracking';
import { POST as edit } from '@/app/api/artifacts/[id]/edits/route';
import { artifactState } from '@/lib/artifact-state';
import { GET as versions } from '@/app/api/artifacts/[id]/versions/route';

useAppHarness();

describe('cli-restore', () => {
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
   const cli=await cliWorkspace('handler-restore');const calls:string[]=[];
   const invoke=(args:string[])=>cli.run(args,transport(calls));
   try{
    const token=await mintToken('mxmx_test_cli_restore');
    await cli.useToken(token.token);
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
   }finally{await cli.cleanup();}
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
   const cli=await cliWorkspace('handler-refresh');const calls:string[]=[];const keys:Array<string|null>=[];
   const recorded:typeof fetch=async(input,init)=>{
    const message=new Request(input,init);
    if(message.method==='POST'&&new URL(message.url).pathname==='/api/artifacts/assets/refresh')keys.push(message.headers.get('Idempotency-Key'));
    return transport(calls)(message);
   };
   const invoke=(args:string[])=>cli.run(args,recorded);
   try{
    const token=await mintToken('mxmx_test_cli_refresh');
    await cli.useToken(token.token);
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
   }finally{await cli.cleanup();}
  });

  it('a delete whose reply is lost completes on the repeated command instead of stranding its journal',async()=>{
   const cli=await cliWorkspace('handler-delete-recovery');const root=cli.root;const calls:string[]=[];
   let dropReply=true;
   // The first DELETE reaches the real route and commits; only its reply is lost.
   const lossy:typeof fetch=async(input,init)=>{
    const message=new Request(input,init);
    if(message.method==='DELETE'&&dropReply){dropReply=false;await transport(calls)(message);throw new Error('deleted, but the reply was lost');}
    return transport(calls)(message);
   };
   const invoke=(args:string[])=>cli.run(args,lossy);
   const journal=()=>readRecord<{path:string;body:unknown}>(root,root,'pending-operation','current');
   try{
    const token=await mintToken('mxmx_test_delete_recovery');const actor={tokenId:token.id,userId:null};
    await cli.useToken(token.token);
    const created=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Lost reply</p>'}}))).json();

    const interrupted=await invoke(['delete',created.id]);
    expect(interrupted.code).not.toBe(0);
    expect(await ownedArtifactState(actor,created.id)).toEqual({deleted:true});
    expect(JSON.stringify(await journal())).toContain(created.id);

    // The row is in the trash now, so the delete's own pre-read would 404 on the
    // way back in. Repeating the command has to finish the journalled operation.
    const recovered=await invoke(['delete',created.id]);
    expect(recovered.code,JSON.stringify(recovered.result)).toBe(0);
    expect(recovered.result).toMatchObject({id:created.id,status:'deleted',local_file:'preserved'});
    expect(await journal()).toBeNull();
    expect(await ownedArtifactState(actor,created.id)).toEqual({deleted:true});
    // The retry re-sent the same operation key, and the receipt answered it.
    expect(calls.filter(call=>call.startsWith('DELETE'))).toHaveLength(2);
   }finally{await cli.cleanup();}
  });
});

describe('cli-mixed-rebase', () => {
  it.each([true,false])('atomic replacement retains node-scoped history (content changed: %s)',async contentChanged=>{
   const token=await mintToken('mxmx_test_cli_mixed');
   const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<div><p>First</p><p>Second</p></div>'}}));
   expect(created.status).toBe(201);const {id}=await created.json();const base=(await getArtifactById(id))!;
   const params={params:Promise.resolve({id})};
   const changed=await replace(request(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:{markup:contentChanged?base.source!.replace('First','Writer one'):base.source,title:'New title',expectedVersion:base.version,expectedState:artifactState(base)}}),params);
   expect(changed.status).toBe(200);
   const concurrent=await edit(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:{edit_id:base.edit_id,source:base.source!.replace('Second','Writer two')}}),params);
   expect(concurrent.status,await concurrent.clone().text()).toBe(200);
   const head=(await getArtifactById(id))!;
   expect(head.source).toContain(contentChanged?'Writer one':'First');expect(head.source).toContain('Writer two');expect(head.title).toBe('New title');
  });
});

describe('cli-preconditions', () => {
  it('requires both the observed version and state on full HTTP replacements',async()=>{
   const token=await mintToken('conditions');
   const row=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>One</p>'}}))).json();const ctx={params:Promise.resolve({id:row.id})};
   const head=await(await read(request(`/api/artifacts/${row.id}`,{token:token.token}),ctx)).json();
   const put=(body:Record<string,unknown>)=>replace(request(`/api/artifacts/${row.id}`,{method:'PUT',token:token.token,json:{markup:'<p>Two</p>',...body}}),ctx);
   for(const input of [{},{expectedVersion:head.version},{expectedState:head.state}])expect((await put(input)).status).toBe(400);
   const okay=await put({expectedVersion:head.version,expectedState:head.state});expect(okay.status).toBe(200);
   expect((await put({expectedVersion:head.version,expectedState:head.state})).status).toBe(409);
  });
  it('browser metadata uses the same state condition as the bearer API',async()=>{
   const {agentCookie}=await import('./harness');const {PATCH}=await import('@/app/api/my/artifacts/[id]/route');
   const token=await mintToken('browser-condition');const row=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>One</p>'}}))).json();
   const response=await PATCH(request(`/api/my/artifacts/${row.id}`,{method:'PATCH',cookie:await agentCookie([token.id]),json:{title:'Changed'}}),{params:Promise.resolve({id:row.id})});
   expect(response.status).toBe(400);expect((await response.json()).error).toBe('state_required');
  });
  it('refuses metadata on the body-edit endpoint instead of bypassing state conditions',async()=>{
   const {POST:edit}=await import('@/app/api/artifacts/[id]/edits/route');const token=await mintToken('edit-metadata');
   const row=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>One</p>'}}))).json();
   const response=await edit(request(`/api/artifacts/${row.id}/edits`,{method:'POST',token:token.token,json:{edit_id:row.edit_id,title:'Changed'}}),{params:Promise.resolve({id:row.id})});expect(response.status).toBe(400);expect((await response.json()).error).toBe('metadata_requires_patch');
  });
  it('requires observed conditions when reverting a retained version',async()=>{
   const {POST:revert}=await import('@/app/api/artifacts/[id]/revert/route');const token=await mintToken('revert-conditions');
   const row=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>One</p>'}}))).json();const ctx={params:Promise.resolve({id:row.id})};
   const head=await(await read(request(`/api/artifacts/${row.id}`,{token:token.token}),ctx)).json();
   expect((await replace(request(`/api/artifacts/${row.id}`,{method:'PUT',token:token.token,json:{markup:'<p>Two</p>',expectedVersion:head.version,expectedState:head.state}}),ctx)).status).toBe(200);
   const denied=await revert(request(`/api/artifacts/${row.id}/revert`,{method:'POST',token:token.token,json:{version:1}}),ctx);expect(denied.status).toBe(400);
   const current=await(await read(request(`/api/artifacts/${row.id}`,{token:token.token}),ctx)).json();
   const okay=await revert(request(`/api/artifacts/${row.id}/revert`,{method:'POST',token:token.token,json:{version:1,expectedVersion:current.version,expectedState:current.state}}),ctx);expect(okay.status).toBe(200);
  });
  it('refuses an incompatible CLI write contract before creating anything and advertises the supported protocol',async()=>{
   const token=await mintToken('protocol');
   for(const protocol of ['0','2','unknown']){
    const response=await create(request('/api/artifacts',{method:'POST',token:token.token,headers:{'X-Artifactbin-Protocol':protocol},json:{markup:'<p>Must not publish</p>'}}));
    expect(response.status).toBe(426);expect(await response.json()).toMatchObject({error:'cli_update_required',required_protocol:1});expect(response.headers.get('X-Artifactbin-Protocol')).toBe('1');
   }
   const response=await create(request('/api/artifacts',{method:'POST',token:token.token,headers:{'X-Artifactbin-Protocol':'1'},json:{markup:'<p>Supported contract</p>'}}));
   expect(response.status).toBe(201);expect(response.headers.get('X-Artifactbin-Protocol')).toBe('1');
  });
});

describe('cli-pages', () => {
  it('paginates artifacts with an opaque cursor without duplicates or leaking another account',async()=>{
   const token=await mintToken('pages');const other=await mintToken('other');
   for(let i=0;i<5;i++)await createArtifact(token.id,null,{title:String(i),format:'markup',content:'',source:'<p />',meta:{}});
   await createArtifact(other.id,null,{title:'secret',format:'markup',content:'',source:'<p />',meta:{}});
   const ids:string[]=[];let cursor:string|undefined;
   do{const response=await list(request('/api/artifacts?limit=2'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{token:token.token}));expect(response.status).toBe(200);const page=await response.json();expect(page.artifacts.length).toBeLessThanOrEqual(2);ids.push(...page.artifacts.map((row:{id:string})=>row.id));cursor=page.next_cursor;}while(cursor);
   expect(ids).toHaveLength(5);expect(new Set(ids).size).toBe(5);
   const invalid=await list(request('/api/artifacts?limit=0',{token:token.token}));expect(invalid.status).toBe(400);
  });

  it('lists the current head in version history and refuses foreign or malformed cursors', async()=>{
   const token=await mintToken('history');
   const artifact=await createArtifact(token.id,null,{title:'head',format:'markup',content:'',source:'<p />',meta:{}});
   const response=await versions(request(`/api/artifacts/${artifact.id}/versions?limit=1`,{token:token.token}),{params:Promise.resolve({id:artifact.id})});
   expect(response.status).toBe(200);const page=await response.json();expect(page.versions.map((v:{version:number})=>v.version)).toEqual([1]);expect(page.next_cursor).toBeNull();
   const bad=await list(request('/api/artifacts?cursor=garbage',{token:token.token}));expect(bad.status).toBe(400);
  });

  it('version history can begin at a selected historical version',async()=>{
   const token=await mintToken('selected-history');const actor={tokenId:token.id,userId:null};
   const artifact=await createArtifact(token.id,null,{title:'one',format:'markup',content:'',source:'<p />',meta:{}});
   for(const title of ['two','three'])await replaceArtifactFor(actor,artifact.id,{title,format:'markup',content:'',source:`<p>${title}</p>`,meta:{}});
   const response=await versions(request(`/api/artifacts/${artifact.id}/versions?version=2&limit=1`,{token:token.token}),{params:Promise.resolve({id:artifact.id})});
   expect(response.status).toBe(200);const page=await response.json();expect(page.versions.map((v:{version:number})=>v.version)).toEqual([2]);expect(page.next_cursor).toBeTruthy();
   const next=await versions(request(`/api/artifacts/${artifact.id}/versions?version=2&cursor=${encodeURIComponent(page.next_cursor)}`,{token:token.token}),{params:Promise.resolve({id:artifact.id})});expect((await next.json()).versions.map((v:{version:number})=>v.version)).toEqual([1]);
  });
});
