/** Native replacement for retired JSX deep-copy behavior: explicit live/pinned dataset links retain their ACLs, and
 * the page quota refuses the whole copy. */
import {afterEach,expect,it} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as fork} from '@/app/api/artifacts/[id]/fork/route';
import {getArtifactById} from '@/lib/artifacts';
import { setArtifactQuotaForTests } from '@/lib/artifacts/testing';
const harness=useAppHarness();afterEach(()=>{setArtifactQuotaForTests(null);});
async function world(){
 const owner=await mintAccountToken('clone-owner'),reader=await mintAccountToken('clone-reader');
 const post=async(body:unknown)=>{const r=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:body}));expect(r.status).toBe(201);return r.json();};
 const dataset=await post({dataset:[{amount:7}],visibility:'public'});
 const page=await post({html:`<html><head><link rel="af-dataset" data-af-name="live" href="ref:${dataset.id}"><link rel="af-dataset" data-af-name="fixed" href="ref:${dataset.id}" data-af-mode="pinned" data-af-revision="1"></head><body><h1>Shared app</h1></body></html>`,visibility:'public'});
 const row=(await getArtifactById(page.id))!,links=row.meta.htmlLinks as Array<{kind:string;name:string}>;
 const send=()=>fork(request(`/api/artifacts/${page.id}/fork`,{method:'POST',token:reader.token,json:{}}),{params:Promise.resolve({id:page.id})});
 const owned=async()=>Number((await(await harness.db()).query<{n:number}>('SELECT count(*)::int n FROM artifacts WHERE user_id=$1',[reader.userId])).rows[0]!.n);
 return {owner,reader,dataset,page,row,links,send,owned};
}
it('preserves live/pinned dataset links',async()=>{
 const w=await world(),r=await w.send();expect(r.status).toBe(201);const reply=await r.json();expect(reply.datasets).toEqual([]);const copy=(await getArtifactById(reply.id))!;
 expect(copy.user_id).toBe(w.reader.userId);expect(copy.forked_from).toBe(w.page.id);expect(copy.version).toBe(1);
 const links=copy.meta.htmlLinks as typeof w.links;
 expect(links).toEqual(w.links);expect(links.map(l=>l.kind)).toEqual(['dataset','dataset']);
 expect(await w.owned()).toBe(1);
});
it('revoked dataset readership refuses a copy without granting access through the public page',async()=>{
 const w=await world();await(await harness.db()).query("UPDATE artifacts SET visibility='private' WHERE id=$1",[w.dataset.id]);const response=await w.send();expect(response.status).toBe(400);expect(await w.owned()).toBe(0);
});
it('the native page quota refuses the entire clone',async()=>{
 const w=await world();const seed=await create(request('/api/artifacts',{method:'POST',token:w.reader.token,json:{html:'<p>Existing page</p>'}}));expect(seed.status).toBe(201);setArtifactQuotaForTests(1);const response=await w.send();expect(response.status).toBe(403);expect((await response.json()).error).toBe('quota_exceeded');expect(await w.owned()).toBe(1);
});
