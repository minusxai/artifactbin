/** Native identities, atomic replacement and comments through retained artifact routes.
 * The removed JSX splice/batch/rebase protocol is replaced by whole-file CAS.
 */
import {expect,it} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import {nativeHtml} from './native-html-fixture';
import {nativeAnchor} from './native-annotation-fixture';
import {observedRequest,patchMetadata} from './conditional-request';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as read,PUT as replace} from '@/app/api/artifacts/[id]/route';
import {POST as revert} from '@/app/api/artifacts/[id]/revert/route';
import {POST as comment} from '@/app/api/my/artifacts/[id]/annotations/route';
import {DELETE as deleteComment} from '@/app/api/my/artifacts/[id]/annotations/[annId]/route';
import {createArtifact} from '@/lib/artifacts';
const harness=useAppHarness();
const ctx=(id:string)=>({params:Promise.resolve({id})});
async function setup(body='<main><p data-af-id="text">Hello</p></main>'){
 const token=await mintAccountToken('node-project');
 const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeHtml(body)}}));
 expect(response.status).toBe(201);const first=await response.json(),id=first.id as string;
 const head=async()=>await(await read(request(`/api/artifacts/${id}`,{token:token.token}),ctx(id))).json();
 const save=(html:string,base=first)=>replace(request(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:{html,expectedVersion:base.version,expectedState:base.state}}),ctx(id));
 return {token,id,first,head,save};
}
const ids=(html:string)=>[...html.matchAll(/data-af-id="([^"]+)"/g)].map(match=>match[1]);
it('allocates a unique identity on every saved element and echoes canonical source',async()=>{
 const s=await setup();const all=ids(s.first.html);
 expect(all.length).toBe((s.first.html.match(/<[A-Za-z][^>]*>/g)??[]).length);
 expect(new Set(all).size).toBe(all.length);expect(all).toContain('text');
 expect((await s.head()).html).toBe(s.first.html);
});
it('refuses duplicate identities at direct storage without inserting an artifact',async()=>{
 const token=await mintAccountToken('invalid-direct');
 await expect(createArtifact(token.id,token.userId,{format:'html',source:nativeHtml('<p data-af-id="same">A</p><p data-af-id="same">B</p>'),meta:{}})).rejects.toThrow();
 expect((await(await harness.db()).query('SELECT id FROM artifacts WHERE token_id=$1',[token.id])).rows).toEqual([]);
});
it('commits a move in one replacement while keeping stable identities; a stale sibling save cannot overwrite it',async()=>{
 const s=await setup('<main><p data-af-id="moving">Move</p><section data-af-id="destination"></section></main>');
 const moving=s.first.html.match(/<p[^>]*>Move<\/p>/)![0];
 const source=s.first.html.replace(moving,'').replace('</section>',moving+'</section>');
 const changed=await s.save(source);expect(changed.status).toBe(200);const current=await changed.json();
 expect(current.version).toBe(2);expect(current.html).toContain(moving+'</section>');expect(ids(current.html)).toContain('moving');
 const stale=await s.save(s.first.html.replace('Move','Clobber'));expect(stale.status).toBe(409);
 expect(await s.head()).toMatchObject({html:current.html,version:2});
});
it('an invalid replacement leaves source, head and archived history untouched',async()=>{
 const s=await setup();const before=await s.head();
 const refused=await s.save(nativeHtml('<p data-af-id="same">A</p><p data-af-id="same">B</p>'));expect(refused.status).toBe(400);
 expect(await s.head()).toEqual(before);
 expect((await(await harness.db()).query('SELECT version FROM artifact_versions WHERE artifact_id=$1',[s.id])).rows).toEqual([]);
});
it('creating and deleting a comment does not change source identities or version',async()=>{
 const s=await setup();const actor={credential:'session' as const,userId:s.token.userId!,email:s.token.email!,emailVerified:true};
 const made=await comment(request(`/api/my/artifacts/${s.id}/annotations`,{method:'POST',actor,json:{anchor:nativeAnchor('text'),body:'Review'}}),ctx(s.id));
 expect(made.status).toBe(201);const annotation=await made.json();
 const removed=await deleteComment(request(`/api/my/artifacts/${s.id}/annotations/${annotation.id}`,{method:'DELETE',actor}),{params:Promise.resolve({id:s.id,annId:annotation.id})});
 expect(removed.status).toBe(200);expect(await s.head()).toMatchObject({html:s.first.html,version:s.first.version});
});
it('never reuses a removed identity for a new element',async()=>{
 const s=await setup();const source=s.first.html.replace(/<p[^>]*>Hello<\/p>/,'<section>New</section>');
 const updated=await s.save(source);expect(updated.status).toBe(200);const head=await updated.json();
 expect(ids(head.html)).not.toContain('text');
 const reuse=await s.save(head.html.replace('</body>','<p data-af-id="text">Reuse</p></body>'),head);
 expect(reuse.status).toBe(400);expect((await s.head()).html).toBe(head.html);
});
it('direct creation stamps identities and archived restore preserves the original identity',async()=>{
 const token=await mintAccountToken('direct');
 const row=await createArtifact(token.id,token.userId,{format:'html',source:nativeHtml('<p data-af-id="returning">Back</p>'),meta:{}});
 expect(ids(row.source!)).toContain('returning');expect(ids(row.source!).length).toBeGreaterThan(1);
 const s=await setup();expect((await s.save(s.first.html.replace(/<p[^>]*>Hello<\/p>/,'<p>Changed</p>'))).status).toBe(200);
 const restored=await revert(await observedRequest(`/api/artifacts/${s.id}/revert`,{method:'POST',token:s.token.token,json:{version:1}}),ctx(s.id));
 expect(restored.status).toBe(200);expect(await restored.json()).toMatchObject({html:s.first.html,version:3});
});
it('metadata-only writes preserve canonical source bytes',async()=>{
 const s=await setup();const response=await patchMetadata(s.token.token,s.id,{title:'Named'});
 expect(response.status).toBe(200);expect((await s.head()).html).toBe(s.first.html);
});
