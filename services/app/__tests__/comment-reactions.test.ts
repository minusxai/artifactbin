import { describe, expect, it } from 'vitest';
import { useAppHarness, request, mintAccountToken } from './harness';
import { avatarUrl } from '@/lib/avatars';
import { createUser, identityForUser, ownerUsername } from '@/lib/accounts';
const face=async(id:string)=>({kind:'human',label:await ownerUsername(id),user_id:id,image:avatarUrl({id,image_key:null})});
import { createArtifact, updateSharingFor } from '@/lib/artifacts';
import { listAnnotationsFor } from '@/lib/annotations';
import { getDb } from '@/lib/platform/db';
import { measureQueries } from '@/lib/platform';
import { COMMENT_REACTORS_MAX } from '@artifactbin/contracts';
import { nativeHtml } from './native-html-fixture';
import { nativeAnchor } from './native-annotation-fixture';
import { POST as create } from '@/app/api/my/artifacts/[id]/annotations/route';
import { PUT as react } from '@/app/api/my/artifacts/[id]/annotations/[annId]/reactions/route';
import { PUT as bearerReact } from '@/app/api/artifacts/[id]/annotations/[annId]/reactions/route';
import { POST as reply, DELETE as remove } from '@/app/api/my/artifacts/[id]/annotations/[annId]/route';
import type { AnnotationWire } from '@/lib/annotations';
useAppHarness();
const ctx = (id: string, annId = '') => ({params: Promise.resolve({id, annId})});
async function person(name: string) {
 const user = await createUser({email:`mxmx_test_react_${name}@example.com`});
 const token = await mintAccountToken(name,user.id);
 return { user,token,actor:identityForUser(user.id,token.id),session:{credential:'session' as const,userId:user.id,email:user.email!,emailVerified:true} };
}
async function world() {
 const owner=await person('owner'),viewer=await person('viewer'),other=await person('other');
 const row=await createArtifact(owner.token.id,owner.user.id,{format:'html',source:nativeHtml('<p data-af-id="p">A paragraph.</p>'),meta:{},visibility:'private',title:'Reactions'});
 await updateSharingFor(owner.actor,row.id,{shares:[{email:viewer.user.email!,role:'viewer'}]});
 const res=await create(request(`/api/my/artifacts/${row.id}/annotations`,{method:'POST',actor:owner.session,json:{body:'Looks good',anchor:nativeAnchor('p')}}),ctx(row.id));
 expect(res.status,await res.clone().text()).toBe(201);
 return {owner,viewer,other,id:row.id,thread:await res.json() as AnnotationWire};
}
const send=(w:Awaited<ReturnType<typeof world>>,who:Awaited<ReturnType<typeof person>>,active:boolean,comment=w.thread.id)=>react(request(`/api/my/artifacts/${w.id}/annotations/${comment}/reactions`,{method:'PUT',actor:who.session,json:{kind:'thumbs_up',active}}),ctx(w.id,comment));
const counts=(reactions:AnnotationWire['thread'][number]['reactions'])=>reactions?.map(({by:_by,...rest})=>rest);
const summary=(thread:AnnotationWire)=>counts(thread.thread[0]!.reactions);
describe('account comment reactions',()=>{
 it('lets admitted viewers add, retry and remove their own reaction; counts distinct accounts',async()=>{
  const w=await world();
  expect(summary(await (await send(w,w.viewer,true)).json())).toEqual([{kind:'thumbs_up',count:1,viewer_reacted:true}]);
  const concurrent=await Promise.all([send(w,w.owner,true),send(w,w.viewer,true),send(w,w.viewer,true)]);
  expect(concurrent.map(r=>r.status)).toEqual([200,200,200]);
  const read=(await listAnnotationsFor(w.viewer.actor,w.id))![0]!;
  expect(summary(read)).toEqual([{kind:'thumbs_up',count:2,viewer_reacted:true}]);
  expect(summary(await (await send(w,w.viewer,false)).json())).toEqual([{kind:'thumbs_up',count:1,viewer_reacted:false}]);
  expect(summary(await (await send(w,w.viewer,false)).json())).toEqual([{kind:'thumbs_up',count:1,viewer_reacted:false}]);
  expect(summary((await listAnnotationsFor(w.owner.actor,w.id))![0]!)).toEqual([{kind:'thumbs_up',count:1,viewer_reacted:true}]);
 });
 it('refuses inaccessible, wrong-artifact, missing and deleted comments uniformly',async()=>{
  const w=await world();
  expect((await send(w,w.other,true)).status).toBe(404);
  expect((await send(w,w.owner,true,'ann_missing')).status).toBe(404);
  const second=await createArtifact(w.owner.token.id,w.owner.user.id,{format:'html',source:nativeHtml('<p data-af-id="p">Other</p>'),meta:{},visibility:'private'});
  expect((await react(request(`/api/my/artifacts/${second.id}/annotations/${w.thread.id}/reactions`,{method:'PUT',actor:w.owner.session,json:{kind:'thumbs_up',active:true}}),ctx(second.id,w.thread.id))).status).toBe(404);
  expect((await remove(request(`/api/my/artifacts/${w.id}/annotations/${w.thread.id}`,{method:'DELETE',actor:w.owner.session}),ctx(w.id,w.thread.id))).status).toBe(200);
  expect((await send(w,w.owner,true)).status).toBe(404);
 });
 it('reacts to replies on resolved threads and exposes counts to anonymous admitted readers',async()=>{
  const w=await world();
  const replied=await reply(request(`/api/my/artifacts/${w.id}/annotations/${w.thread.id}`,{method:'POST',actor:w.owner.session,json:{reply:'Thanks!',resolve:true}}),ctx(w.id,w.thread.id));
  const thread=await replied.json() as AnnotationWire, replyId=thread.thread[1]!.id;
  expect(replied.status).toBe(200);
  const answer=await send(w,w.viewer,true,replyId);expect(answer.status).toBe(200);
  const updated=await answer.json() as AnnotationWire;
  expect(updated.status).toBe('resolved');expect(updated.revision).toBe(thread.revision);
  expect(updated.thread[0]!.reactions).toEqual([]);
  expect(counts(updated.thread[1]!.reactions)).toEqual([{kind:'thumbs_up',count:1,viewer_reacted:true}]);
  await updateSharingFor(w.owner.actor,w.id,{visibility:'unlisted',shares:[]});
  const anonymous={userId:null,tokenId:null,email:null,documentEditor:false};
  const read=(await listAnnotationsFor(anonymous,w.id,{status:'all'}))![0]!;
  expect(counts(read.thread[1]!.reactions)).toEqual([{kind:'thumbs_up',count:1,viewer_reacted:false}]);
  // D18: reactors follow the comment-author rule, so an anonymous admitted reader who sees who wrote each comment
  // also sees who reacted. Before, reactors were hidden from every reader.
  expect(read.thread[0]!.author.user_id).toBe(w.owner.user.id);
  expect(read.thread[1]!.reactions![0]!.by).toEqual([await face(w.viewer.user.id)]);
  await updateSharingFor(w.owner.actor,w.id,{visibility:'private',shares:[]});
  expect((await send(w,w.viewer,false,replyId)).status).toBe(404);
 });
 it('supports account bearer requests and rejects unsupported kinds and anonymous writes',async()=>{
  const w=await world();
  const res=await bearerReact(request(`/api/artifacts/${w.id}/annotations/${w.thread.id}/reactions`,{method:'PUT',token:w.viewer.token.token,json:{kind:'thumbs_up',active:true}}),ctx(w.id,w.thread.id));
  expect(res.status,await res.clone().text()).toBe(200);
  expect(summary(await res.json())).toEqual([{kind:'thumbs_up',count:1,viewer_reacted:true}]);
  expect((await react(request(`/api/my/artifacts/${w.id}/annotations/${w.thread.id}/reactions`,{method:'PUT',actor:w.owner.session,json:{kind:'heart',active:true}}),ctx(w.id,w.thread.id))).status).toBe(400);
  expect((await react(request(`/api/my/artifacts/${w.id}/annotations/${w.thread.id}/reactions`,{method:'PUT',json:{kind:'thumbs_up',active:true}}),ctx(w.id,w.thread.id))).status).not.toBe(200);
 });
 it('lists reactors by the author rule: people with their account, agents by label without one',async()=>{
  const w=await world();
  await send(w,w.viewer,true);
  const res=await bearerReact(request(`/api/artifacts/${w.id}/annotations/${w.thread.id}/reactions`,{method:'PUT',token:w.owner.token.token,json:{kind:'thumbs_up',active:true},headers:{'Artifactbin-Agent':'Claude Code'}}),ctx(w.id,w.thread.id));
  expect(res.status,await res.clone().text()).toBe(200);
  const reaction=(await res.json() as AnnotationWire).thread[0]!.reactions![0]!;
  expect(reaction).toMatchObject({kind:'thumbs_up',count:2,viewer_reacted:true});
  expect(reaction.by).toEqual([
   await face(w.viewer.user.id),
   {kind:'agent',label:'Claude Code',user_id:null,image:null},
  ]);
  // Every admitted reader gets the same reactors; only viewer_reacted is personal.
  const asViewer=(await listAnnotationsFor(w.viewer.actor,w.id))![0]!.thread[0]!.reactions![0]!;
  expect(asViewer.by).toEqual(reaction.by);expect(asViewer.viewer_reacted).toBe(true);
  expect(await listAnnotationsFor(w.other.actor,w.id)).toBeNull();
 });
 it('caps listed reactors per kind while the count stays exact, in one statement however many comments',async()=>{
  const w=await world();const db=await getDb();
  await db.query(`INSERT INTO comment_reactions (comment_id,user_id,kind,reactor_kind,reactor_label,created_at)
   SELECT $1,'usr_bulk'||n,'thumbs_up','human','bulk'||n,now()+n*interval '1 second' FROM generate_series(1,$2::int) n`,[w.thread.id,COMMENT_REACTORS_MAX+5]);
  const reaction=(await listAnnotationsFor(w.owner.actor,w.id))![0]!.thread[0]!.reactions![0]!;
  expect(reaction.count).toBe(COMMENT_REACTORS_MAX+5);expect(reaction.by).toHaveLength(COMMENT_REACTORS_MAX);
  expect(reaction.by![0]).toEqual({kind:'human',label:'bulk1',user_id:'usr_bulk1',image:avatarUrl({id:'usr_bulk1',image_key:null})});
  const one=await measureQueries(()=>listAnnotationsFor(w.owner.actor,w.id));
  for(let i=0;i<3;i++){
   const res=await reply(request(`/api/my/artifacts/${w.id}/annotations/${w.thread.id}`,{method:'POST',actor:w.owner.session,json:{reply:`Reply ${i}`}}),ctx(w.id,w.thread.id));
   await send(w,w.viewer,true,(await res.json() as AnnotationWire).thread.at(-1)!.id);
  }
  const many=await measureQueries(()=>listAnnotationsFor(w.owner.actor,w.id));
  expect(many.stats.count).toBe(one.stats.count);
 });
});
