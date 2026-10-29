import {nativeHtml} from './native-html-fixture';
import {nativeAnchor} from './native-annotation-fixture';
import {htmlTextFingerprint} from '@artifactbin/contracts';
import {it,expect} from 'vitest';
import {useAppHarness,request} from '@/__tests__/harness';
import { createUser } from '@/lib/accounts';
import { claimToken } from '@/lib/authentication';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {POST as createArtifact} from '@/app/api/artifacts/route';
import {POST as createComment,GET as listComments} from '@/app/api/artifacts/[id]/annotations/route';
import {POST as actOnComment} from '@/app/api/artifacts/[id]/annotations/[annId]/route';
useAppHarness();
const params=(value:Record<string,string>)=>({params:Promise.resolve(value)});
async function fixture(){const user = await createUser({email:'mxmx_test_local_comments@example.com'}); const token = await mintToken('offline-publication', user.id);await claimToken(user.id,token.token);const made=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeHtml('<p data-af-id="p001">One paragraph.</p>')}}));expect(made.status).toBe(201);return{token:token.token,user,id:(await made.json()).id};}
it('HTTP comment creation retains node, selected words and range while attributing the authenticated account',async()=>{
 const f=await fixture();const range={start:4,end:13,length:14,fingerprint:htmlTextFingerprint('One paragraph.')};const response=await createComment(request(`/api/artifacts/${f.id}/annotations`,{method:'POST',token:f.token,json:{anchor:{...nativeAnchor('p001',1,'paragraph'),range},body:'Offline note'}}),params({id:f.id}));expect(response.status,await response.clone().text()).toBe(201);const annotation=await response.json();expect(annotation.quote).toBe('paragraph');expect(annotation.anchor.range).toEqual(range);expect(annotation.thread[0].author).toMatchObject({kind:'agent',transport:'http',user_id:null});
});
it('concurrent reply+resolve keeps both replies, resolves once and reports the losing state change',async()=>{
 const f=await fixture();const created=await createComment(request(`/api/artifacts/${f.id}/annotations`,{method:'POST',token:f.token,json:{anchor:nativeAnchor('p001'),body:'First'}}),params({id:f.id}));expect(created.status).toBe(201);const annotation=await created.json();
 const invoke=(reply:string)=>actOnComment(request(`/api/artifacts/${f.id}/annotations/${annotation.id}`,{method:'POST',token:f.token,json:{reply,resolve:true,expected_revision:annotation.revision}}),params({id:f.id,annId:annotation.id}));const responses=await Promise.all([invoke('First concurrent reply'),invoke('Second concurrent reply')]);expect(responses.map(response=>response.status)).toEqual([200,200]);const bodies=await Promise.all(responses.map(response=>response.json()));expect(bodies.filter(body=>body.status_conflict===true)).toHaveLength(1);
 const listed=await listComments(request(`/api/artifacts/${f.id}/annotations?status=all`,{token:f.token}),params({id:f.id}));const value=(await listed.json()).annotations[0];expect(value.thread).toHaveLength(3);expect(value.status).toBe('resolved');expect(value.revision).toBe(annotation.revision+2);
});
