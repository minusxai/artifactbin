/** Native captures keep selected words and raw text offsets under a stable HTML identity. */
import {expect,it} from 'vitest';
import {htmlTextFingerprint,type HtmlNodeAnchor} from '@artifactbin/contracts';
import {useAppHarness,request,mintAccountToken} from './harness';
import {nativeHtml} from './native-html-fixture';
import {nativeAnchor} from './native-annotation-fixture';
import {observedRequest} from './conditional-request';
import {POST as createPage} from '@/app/api/artifacts/route';
import {PUT as updatePage} from '@/app/api/artifacts/[id]/route';
import {POST as createComment} from '@/app/api/my/artifacts/[id]/annotations/route';
import {GET as listComments} from '@/app/api/artifacts/[id]/annotations/route';
useAppHarness();
const params=(id:string)=>({params:Promise.resolve({id})});
const text='Revenue grew 40% in Q3, ahead of plan.';
const body='<p data-af-id="intro">An intro paragraph.</p><p data-af-id="rev"><strong>Revenue grew</strong> 40% in Q3, ahead of plan.</p><p data-af-id="costs">Costs fell too.</p>';
async function fixture(source=body){const t=await mintAccountToken('quote');const made=await createPage(request('/api/artifacts',{method:'POST',token:t.token,json:{html:nativeHtml(source)}}));expect(made.status).toBe(201);const doc=await made.json();const actor={credential:'session' as const,userId:t.userId!,email:t.email!,emailVerified:true};return{t,doc,actor};}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const capture=(words='grew 40% in Q3,',nodeText=text):HtmlNodeAnchor=>({...nativeAnchor('rev',1,words),range:{start:nodeText.indexOf(words),end:nodeText.indexOf(words)+words.length,length:nodeText.length,fingerprint:htmlTextFingerprint(nodeText)}});
const comment=(f:Fixture,anchor:HtmlNodeAnchor,extra={})=>createComment(request(`/api/my/artifacts/${f.doc.id}/annotations`,{method:'POST',actor:f.actor,json:{anchor,body:'Check these words',...extra}}),params(f.doc.id));
const list=async(f:Fixture)=>{const r=await listComments(request(`/api/artifacts/${f.doc.id}/annotations`,{token:f.t.token}),params(f.doc.id));expect(r.status).toBe(200);return(await r.json()).annotations;};
async function replace(f:Fixture,source:string){const r=await updatePage(await observedRequest(`/api/artifacts/${f.doc.id}`,{method:'PUT',token:f.t.token,json:{html:nativeHtml(source)}}),params(f.doc.id));expect(r.status,await r.clone().text()).toBe(200);}
it('persists a selection across nested text verbatim beside the full current-node snippet',async()=>{const f=await fixture(),anchor=capture();expect((await comment(f,anchor)).status).toBe(201);expect((await list(f))[0]).toMatchObject({anchor,quote:anchor.quote,quote_found:true,snippet:text,orphaned:false});});
it('keeps capture evidence but marks it unverified when an HTML update changes the selected words',async()=>{const f=await fixture(),anchor=capture();await comment(f,anchor);await replace(f,body.replace('grew</strong> 40% in Q3,','fell</strong> 12% in Q4,'));expect((await list(f))[0]).toMatchObject({anchor,quote_found:false,orphaned:false,snippet:'Revenue fell 12% in Q4, ahead of plan.'});});
it('keeps selection verification when only another stable node changes',async()=>{const f=await fixture();await comment(f,capture());await replace(f,body.replace('An intro paragraph.','A different introduction.'));expect((await list(f))[0]).toMatchObject({quote_found:true,orphaned:false});});
it('accepts a quote without offsets and a plain identity without a quote',async()=>{const f=await fixture();expect((await comment(f,nativeAnchor('rev',1,'grew'))).status).toBe(201);expect((await comment(f,nativeAnchor('costs'))).status).toBe(201);const rows=await list(f);expect(rows[0]).toMatchObject({quote:'grew',quote_found:true});expect(rows[1]).toMatchObject({quote_found:null});});
it.each([{start:10,end:2,length:20,fingerprint:'x'},{start:0,end:21,length:20,fingerprint:'x'},{start:0,end:1,length:20,fingerprint:''}])('refuses malformed native offsets without creating a comment (%j)',async range=>{const f=await fixture();expect((await comment(f,{...nativeAnchor('rev',1,'x'),range})).status).toBe(400);expect(await list(f)).toEqual([]);});
it('does not claim source verification for a forged fingerprint or a rendered label absent from source',async()=>{const f=await fixture();expect((await comment(f,{...capture(),range:{...capture().range!,fingerprint:'incorrect'}})).status).toBe(201);expect((await comment(f,nativeAnchor('rev',1,'Rendered runtime label'))).status).toBe(201);expect((await list(f)).every((a:{quote_found:boolean})=>a.quote_found===false)).toBe(true);});
it('uses DOM textContent order without inserting characters between adjacent tags',async()=>{const f=await fixture('<p data-af-id="rev"><span>Rev</span><b>enue</b> grew</p>');const anchor=capture('Revenue grew','Revenue grew');expect((await comment(f,anchor)).status).toBe(201);expect((await list(f))[0]).toMatchObject({quote_found:true,snippet:'Revenue grew'});});
it('stores fractional area evidence without words and rejects contradictory words or out-of-bounds boxes',async()=>{const f=await fixture(),range={v:1,kind:'area',box:{x:0.1,y:0.2,w:0.3,h:0.4}};expect((await comment(f,nativeAnchor('rev'),{range})).status).toBe(201);expect((await list(f))[0].range).toEqual(range);expect((await comment(f,nativeAnchor('rev',1,'Revenue'),{range})).status).toBe(400);expect((await comment(f,nativeAnchor('rev'),{range:{...range,box:{x:2,y:0,w:1,h:1}}})).status).toBe(400);});
