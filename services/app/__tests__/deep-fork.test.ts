/** Native replacement for retired JSX deep-copy behavior: backend identities/stores are private to
 * the clone; explicit live/pinned dataset links retain their ACLs. Quota and rollback remain atomic. */
import {afterEach,expect,it,vi} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as fork} from '@/app/api/artifacts/[id]/fork/route';
import {getArtifactById} from '@/lib/artifacts';
import {setArtifactQuotaForTests} from '@/lib/artifacts/store';
import {getHtmlBackendStore,getHtmlBackendVersion,setHtmlBackendStore} from '@/lib/html-backends';
const fault=vi.hoisted(()=>({fail:false}));
vi.mock('@/lib/page-operations',async original=>({...await original<typeof import('@/lib/page-operations')>(),compilePageBackend:async(source:string)=>({compiled:source,typeDefs:'type Query { count:Int }',secretBindings:['TOKEN']})}));
vi.mock('@/lib/html-backends',async original=>{const real=await original<typeof import('@/lib/html-backends')>();return {...real,commitHtmlBackends:async(...args:Parameters<typeof real.commitHtmlBackends>)=>{const result=await real.commitHtmlBackends(...args);if(fault.fail)throw Error('injected backend-copy failure');return result;}};});
const harness=useAppHarness();afterEach(()=>{fault.fail=false;setArtifactQuotaForTests(null);});
async function world(){
 const owner=await mintAccountToken('clone-owner'),reader=await mintAccountToken('clone-reader');
 const post=async(body:unknown)=>{const r=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:body}));expect(r.status).toBe(201);return r.json();};
 const dataset=await post({dataset:[{amount:7}],visibility:'public'});
 const page=await post({html:`<html><head><link rel="af-backend" data-af-name="one" href="./one.ts"><link rel="af-backend" data-af-name="two" href="./two.ts"><link rel="af-dataset" data-af-name="live" href="ref:${dataset.id}"><link rel="af-dataset" data-af-name="fixed" href="ref:${dataset.id}" data-af-mode="pinned" data-af-revision="1"></head><body><h1>Shared app</h1></body></html>`,backendSources:{one:'one source',two:'two source'},visibility:'public'});
 const row=(await getArtifactById(page.id))!,links=row.meta.htmlLinks as Array<{kind:string;backendId:string;version:string;name:string}>;
 for(const link of links.filter(l=>l.kind==='backend'))await setHtmlBackendStore(link.backendId,{private:link.name},0);
 const send=()=>fork(request(`/api/artifacts/${page.id}/fork`,{method:'POST',token:reader.token,json:{}}),{params:Promise.resolve({id:page.id})});
 const owned=async()=>Number((await(await harness.db()).query<{n:number}>('SELECT count(*)::int n FROM artifacts WHERE user_id=$1',[reader.userId])).rows[0]!.n);
 return {owner,reader,dataset,page,row,links,send,owned};
}
it('clones multiple immutable backends with fresh empty stores and preserves live/pinned dataset links',async()=>{
 const w=await world(),r=await w.send();expect(r.status).toBe(201);const reply=await r.json();expect(reply.datasets).toEqual([]);const copy=(await getArtifactById(reply.id))!;
 expect(copy.user_id).toBe(w.reader.userId);expect(copy.forked_from).toBe(w.page.id);expect(copy.version).toBe(1);
 const links=copy.meta.htmlLinks as typeof w.links;
 expect(links.filter(l=>l.kind==='dataset')).toEqual(w.links.filter(l=>l.kind==='dataset'));
 for(const link of links.filter(l=>l.kind==='backend')){const prior=w.links.find(l=>l.name===link.name)!;expect(link.backendId).not.toBe(prior.backendId);expect(await getHtmlBackendStore(link.backendId)).toEqual({value:null,version:0});expect(await getHtmlBackendStore(prior.backendId)).toEqual({value:{private:link.name},version:1});const backend=await getHtmlBackendVersion(link.backendId,link.version);expect(backend?.ownerId).toBe(w.reader.userId);expect(backend?.source).toBe(link.name+' source');expect(backend?.secretBindings).toEqual(['TOKEN']);}
 expect(await w.owned()).toBe(1);
});
it('revoked dataset readership refuses a copy without granting access through the public page',async()=>{
 const w=await world();await(await harness.db()).query("UPDATE artifacts SET visibility='private' WHERE id=$1",[w.dataset.id]);const response=await w.send();expect(response.status).toBe(400);expect(await w.owned()).toBe(0);
});
it('the native page quota refuses the entire clone before creating any backend identities',async()=>{
 const w=await world();const seed=await create(request('/api/artifacts',{method:'POST',token:w.reader.token,json:{html:'<p>Existing page</p>'}}));expect(seed.status).toBe(201);setArtifactQuotaForTests(1);const response=await w.send();expect(response.status).toBe(403);expect((await response.json()).error).toBe('quota_exceeded');expect(await w.owned()).toBe(1);
});
it('a failure after backend insertion rolls every copied module and store back',async()=>{
 const w=await world(),db=await harness.db();const count=async()=> (await db.query<{n:number}>('SELECT count(*)::int n FROM html_backend_versions')).rows[0]!.n;const before=await count();fault.fail=true;await expect(w.send()).rejects.toThrow('injected backend-copy failure');expect(await count()).toBe(before);expect(await w.owned()).toBe(0);
});
