import {nativeSource} from './native-publication-fixture';
import cliRelease from '../public/chat/release.json';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {CliError} from '../../cli/src/errors';
import {nativePublicationBody as documentPublicationBody} from './native-publication-fixture';
import {restoreDocument,documentEditBody} from './prepared-document';
/**
 * Document lifecycle through the REAL handlers: restore from trash, preconditions on a stale edit,
 * atomic replacement beside a concurrent edit, and paged listing.
 */

import { expect, it } from 'vitest';
import { useAppHarness, request } from './harness';
import { cliWorkspace } from './cli-harness';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { identityForUser, createUser, claimToken } from '@/lib/accounts';
import { getArtifactById, updateSharingFor, createArtifact } from '@/lib/artifacts';
import { ownedArtifactState } from '@/lib/workspace';
import { POST as create, GET as list } from '@/app/api/artifacts/route';
import { GET as read, DELETE as remove, PUT as replace } from '@/app/api/artifacts/[id]/route';
import { POST as restore } from '@/app/api/artifacts/[id]/restore/route';
import { POST as refresh } from '@/app/api/artifacts/assets/refresh/route';
import { readRecord } from '../../cli/test/tracking';
import { POST as edit } from '@/app/api/artifacts/[id]/edits/route';
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

  it('a retried restore or delete under the same operation identity commits once and replays its receipt',async()=>{
   const token=await mintToken('mxmx_test_restore_retry');const actor=identityForUser(token.userId, token.id);
   const created=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeSource('<p>Retry</p>')}}))).json();
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
   const ownerToken=await mintToken('mxmx_test_restore_owner', owner.id);await claimToken(owner.id,ownerToken.token);
   const editor=await createUser({email:'mxmx_test_restore_editor@example.com'});
   const editorToken=await mintToken('mxmx_test_restore_editor', editor.id);await claimToken(editor.id,editorToken.token);
   const created=await(await create(request('/api/artifacts',{method:'POST',token:ownerToken.token,json:{html:nativeSource('<p>Shared</p>')}}))).json();
   await updateSharingFor(identityForUser(owner.id, ownerToken.id),created.id,{shares:[{email:'mxmx_test_restore_editor@example.com',role:'editor'}]});

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
   expect(await ownedArtifactState(identityForUser(owner.id, ownerToken.id),created.id)).toEqual({deleted:true});
  });

  it('refresh reports each url on its own and a retried refresh answers the recorded receipt',async()=>{
   const token=await mintToken('mxmx_test_refresh');
   const created=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeSource('<p>No pictures</p>')}}))).json();
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
});



describe('cli-preconditions', () => {
  it('browser metadata uses the same state condition as the bearer API',async()=>{
   const {PATCH}=await import('@/app/api/my/artifacts/[id]/route');
   const token=await mintToken('browser-condition');const row=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeSource('<p>One</p>')}}))).json();
   const response=await PATCH(request(`/api/my/artifacts/${row.id}`,{method:'PATCH',actor:{credential:'session',userId:token.userId!,email:token.email!,emailVerified:true},json:{title:'Changed'}}),{params:Promise.resolve({id:row.id})});
   expect(response.status).toBe(400);expect((await response.json()).error).toBe('state_required');
  });
  it('refuses metadata on the body-edit endpoint instead of bypassing state conditions',async()=>{
   const {POST:edit}=await import('@/app/api/artifacts/[id]/edits/route');const token=await mintToken('edit-metadata');
   const row=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeSource('<p>One</p>')}}))).json();
   const response=await edit(request(`/api/artifacts/${row.id}/edits`,{method:'POST',token:token.token,json:{edit_id:row.edit_id,title:'Changed'}}),{params:Promise.resolve({id:row.id})});expect(response.status).toBe(404);
  });
  it('requires observed conditions when reverting a retained version',async()=>{
   const {POST:revert}=await import('@/app/api/artifacts/[id]/revert/route');const token=await mintToken('revert-conditions');
   const row=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeSource('<p>One</p>')}}))).json();const ctx={params:Promise.resolve({id:row.id})};
   const head=(await getArtifactById(row.id))!;
   expect((await replace(request(`/api/artifacts/${row.id}`,{method:'PUT',token:token.token,json:documentPublicationBody(head,{html:nativeSource('<p>Two</p>')},true)}),ctx)).status).toBe(200);
   const denied=await revert(request(`/api/artifacts/${row.id}/revert`,{method:'POST',token:token.token,json:{version:1}}),ctx);expect(denied.status).toBe(400);
   const okay=await restoreDocument(token.token,row.id,1);expect(okay.status).toBe(200);
  });
});

describe('cli-pages', () => {
  it('paginates artifacts with an opaque cursor without duplicates or leaking another account',async()=>{
   const token=await mintToken('pages');const other=await mintToken('other');
   for(let i=0;i<5;i++)await createArtifact(token.id, token.userId,{title:String(i),format:'html',source:nativeSource('<p />'),meta:{}});
   await createArtifact(other.id, other.userId,{title:'secret',format:'html',source:nativeSource('<p />'),meta:{}});
   const ids:string[]=[];let cursor:string|undefined;
   do{const response=await list(request('/api/artifacts?limit=2'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{token:token.token}));expect(response.status).toBe(200);const page=await response.json();expect(page.artifacts.length).toBeLessThanOrEqual(2);ids.push(...page.artifacts.map((row:{id:string})=>row.id));cursor=page.next_cursor;}while(cursor);
   expect(ids).toHaveLength(5);expect(new Set(ids).size).toBe(5);
   const invalid=await list(request('/api/artifacts?limit=0',{token:token.token}));expect(invalid.status).toBe(400);
  });

  it('lists the current head in version history and refuses foreign or malformed cursors', async()=>{
   const token=await mintToken('history');
   const artifact=await createArtifact(token.id, token.userId,{title:'head',format:'html',source:nativeSource('<p />'),meta:{}});
   const response=await versions(request(`/api/artifacts/${artifact.id}/versions?limit=1`,{token:token.token}),{params:Promise.resolve({id:artifact.id})});
   expect(response.status).toBe(200);const page=await response.json();expect(page.versions.map((v:{version:number})=>v.version)).toEqual([1]);expect(page.next_cursor).toBeNull();
   const bad=await list(request('/api/artifacts?cursor=garbage',{token:token.token}));expect(bad.status).toBe(400);
  });

  it('version history can begin at a selected historical version',async()=>{
   const token=await mintToken('selected-history');
   const artifact=await createArtifact(token.id, token.userId,{title:'one',format:'html',source:nativeSource('<p />'),meta:{}});
   for(const title of ['two','three'])expect((await replace(request(`/api/artifacts/${artifact.id}`,{method:'PUT',token:token.token,json:documentPublicationBody((await getArtifactById(artifact.id))!,{title,source:nativeSource(`<p>${title}</p>`)},true)}),{params:Promise.resolve({id:artifact.id})})).status).toBe(200);
   const response=await versions(request(`/api/artifacts/${artifact.id}/versions?version=2&limit=1`,{token:token.token}),{params:Promise.resolve({id:artifact.id})});
   expect(response.status).toBe(200);const page=await response.json();expect(page.versions.map((v:{version:number})=>v.version)).toEqual([2]);expect(page.next_cursor).toBeTruthy();
   const next=await versions(request(`/api/artifacts/${artifact.id}/versions?version=2&cursor=${encodeURIComponent(page.next_cursor)}`,{token:token.token}),{params:Promise.resolve({id:artifact.id})});expect((await next.json()).versions.map((v:{version:number})=>v.version)).toEqual([1]);
  });
});

describe('native HTTP replacement conditions',()=>{
 it('requires observed version and state, rejects stale source, and ignores retired client-install headers',async()=>{
  const token=await mintToken('native-conditions');const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeSource('<p>First</p>')},headers:{'User-Agent':'afbin/0.2.5','X-Artifactbin-Protocol':'obsolete'}}));
  expect(created.status).toBe(201);expect(created.headers.get('X-Artifactbin-CLI-Version')).toBeNull();expect(created.headers.get('X-Artifactbin-Protocol')).toBeNull();
  const first=await created.json(),ctx={params:Promise.resolve({id:first.id})},path=`/api/artifacts/${first.id}`;
  expect((await replace(request(path,{method:'PUT',token:token.token,json:{html:nativeSource('<p>No conditions</p>')}}),ctx)).status).toBe(400);
  const body={html:first.html.replace('First','Second'),expectedVersion:first.version,expectedState:first.state};
  const written=await replace(request(path,{method:'PUT',token:token.token,json:body}),ctx);expect(written.status).toBe(200);
  expect((await replace(request(path,{method:'PUT',token:token.token,json:{...body,html:first.html.replace('First','Third')}}),ctx)).status).toBe(409);
  expect((await(await read(request(path,{token:token.token}),ctx)).json()).html).toContain('Second');
 });
});
