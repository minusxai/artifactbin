/** Comments keep their explicit HTML identity through updates and archived restores, never text-matching another node. */
import {expect,it} from 'vitest';
import {useAppHarness,request,mintAccountToken} from './harness';
import {nativeHtml} from './native-html-fixture';
import {nativeAnchor} from './native-annotation-fixture';
import {observedRequest} from './conditional-request';
import {POST as createPage} from '@/app/api/artifacts/route';
import {GET as readPage,PUT as updatePage} from '@/app/api/artifacts/[id]/route';
import {POST as revertPage} from '@/app/api/artifacts/[id]/revert/route';
import {POST as createComment} from '@/app/api/my/artifacts/[id]/annotations/route';
import {DELETE as deleteComment} from '@/app/api/my/artifacts/[id]/annotations/[annId]/route';
import {GET as listComments} from '@/app/api/artifacts/[id]/annotations/route';
const harness=useAppHarness();
const params=(id:string,annId?:string)=>({params:Promise.resolve({id,annId:annId!})});
const source='<p data-af-id="intro">An intro paragraph.</p><div data-af-id="figure">Revenue grew 40% in Q3.</div>';
async function fixture(){const t=await mintAccountToken('anchor');const made=await createPage(request('/api/artifacts',{method:'POST',token:t.token,json:{html:nativeHtml(source)}}));expect(made.status).toBe(201);const doc=await made.json(),actor={credential:'session' as const,userId:t.userId!,email:t.email!,emailVerified:true};const post=()=>createComment(request(`/api/my/artifacts/${doc.id}/annotations`,{method:'POST',actor,json:{anchor:nativeAnchor('figure'),body:'Check this figure'}}),params(doc.id));return{t,doc,actor,post};}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const head=async(f:Fixture)=>{const r=await readPage(request(`/api/artifacts/${f.doc.id}`,{token:f.t.token}),params(f.doc.id));expect(r.status).toBe(200);return r.json();};
const list=async(f:Fixture)=>{const r=await listComments(request(`/api/artifacts/${f.doc.id}/annotations`,{token:f.t.token}),params(f.doc.id));expect(r.status).toBe(200);return(await r.json()).annotations;};
const put=(f:Fixture,html:string)=>updatePageRequest(f,{html:nativeHtml(html)});
async function updatePageRequest(f:Fixture,json:Record<string,unknown>){return updatePage(await observedRequest(`/api/artifacts/${f.doc.id}`,{method:'PUT',token:f.t.token,json}),params(f.doc.id));}
it('opening repeated comments changes neither source identity, head nor archived history',async()=>{const f=await fixture(),before=await head(f);for(let i=0;i<2;i++){const r=await f.post();expect(r.status).toBe(201);expect((await r.json()).anchor).toEqual(nativeAnchor('figure'));}expect(await head(f)).toEqual(before);const versions=await(await harness.db()).query('SELECT version FROM artifact_versions WHERE artifact_id=$1',[f.doc.id]);expect(versions.rows).toHaveLength(0);});
it('keeps the original capture identity through an unrelated update and a whole-page replacement',async()=>{const f=await fixture();await f.post();expect((await put(f,source.replace('An intro paragraph.','A new introduction.'))).status).toBe(200);expect((await list(f))[0]).toMatchObject({anchor:nativeAnchor('figure'),orphaned:false});expect((await put(f,'<h1>New report</h1><div data-af-id="figure">Revenue grew 34% in Q3.</div>')).status).toBe(200);expect((await list(f))[0]).toMatchObject({anchor:nativeAnchor('figure'),orphaned:false,snippet:'Revenue grew 34% in Q3.'});});
it('orphans a removed identity without retargeting identical words elsewhere',async()=>{const f=await fixture();await f.post();expect((await put(f,'<p data-af-id="other">Revenue grew 40% in Q3.</p>')).status).toBe(200);expect((await list(f))[0]).toMatchObject({anchor:nativeAnchor('figure'),orphaned:true,snippet:'Revenue grew 40% in Q3.'});});
it('restores the archived source as a new version and reattaches its exact comment identity',async()=>{const f=await fixture();await f.post();expect((await put(f,'<p>Replacement page</p>')).status).toBe(200);expect((await list(f))[0].orphaned).toBe(true);const r=await revertPage(await observedRequest(`/api/artifacts/${f.doc.id}/revert`,{method:'POST',token:f.t.token,json:{version:f.doc.version}}),params(f.doc.id));expect(r.status,await r.clone().text()).toBe(200);expect((await head(f)).version).toBeGreaterThan(f.doc.version);expect((await list(f))[0]).toMatchObject({anchor:nativeAnchor('figure'),orphaned:false});});
it('rejects a stale whole-page write without changing page source or comment coordinates',async()=>{const f=await fixture();await f.post();const before=await head(f),comments=await list(f);const r=await updatePage(request(`/api/artifacts/${f.doc.id}`,{method:'PUT',token:f.t.token,json:{html:nativeHtml('<p>Uncommitted</p>'),expectedVersion:before.version+1,expectedState:before.state}}),params(f.doc.id));expect(r.status).toBe(409);expect(await head(f)).toEqual(before);expect(await list(f)).toEqual(comments);});
it('deleting the last thread leaves source, head and native IDs unchanged',async()=>{const f=await fixture(),r=await f.post(),ann=await r.json(),before=await head(f);const removed=await deleteComment(request(`/api/my/artifacts/${f.doc.id}/annotations/${ann.id}`,{method:'DELETE',actor:f.actor}),params(f.doc.id,ann.id));expect(removed.status).toBe(200);expect(await head(f)).toEqual(before);expect(await list(f)).toEqual([]);});
