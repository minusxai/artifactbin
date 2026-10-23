import {expect,it} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {PATCH as patch} from '@/app/api/artifacts/[id]/route';
import {PATCH as sessionPatch} from '@/app/api/my/artifacts/[id]/route';
import {getArtifactById} from '@/lib/artifacts';
import {createDocumentGraph} from '@/lib/document/document-graph';
import {prepareClientDocumentUpdate} from '@/lib/document/document-update-client';
useAppHarness();
async function fixture(){
 const owner=await mintAccountToken('native-metadata');
 const response=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:'<html><body><p>Keep native source</p></body></html>',title:'Before'}}));expect(response.status).toBe(201);const page=await response.json();
 return {owner,page,context:{params:Promise.resolve({id:page.id})}};
}
it.each(['bearer','session'] as const)('rejects an otherwise valid graph replacement through the %s metadata admission',async credential=>{
 const f=await fixture(),head=(await getArtifactById(f.page.id))!;
 // Adversarial client supplies a fully valid legacy replacement; malformed-body
 // rejection alone would leave the conversion path open.
 const document_update=prepareClientDocumentUpdate({...head,document:createDocumentGraph('<p>Original</p>',head.version)},{source:'<p>Legacy replacement</p>',whole:true});
 const body={edit_id:head.edit_id,expectedState:f.page.state,document_update};
 const response=credential==='bearer'?await patch(request(`/api/artifacts/${f.page.id}`,{method:'PATCH',token:f.owner.token,json:body}),f.context):await sessionPatch(request(`/api/my/artifacts/${f.page.id}`,{method:'PATCH',origin:'same',actor:{credential:'session',userId:f.owner.userId!,email:f.owner.email!,emailVerified:true},json:body}),f.context);
 expect(response.status).toBe(400);expect((await response.json()).error).toBe('native_html_required');
 expect(await getArtifactById(f.page.id)).toMatchObject({format:'html',version:head.version,source:head.source,title:'Before'});
});
it('patches native metadata conditionally without replacing content or inventing a content version',async()=>{
 const f=await fixture();const send=(json:Record<string,unknown>)=>patch(request(`/api/artifacts/${f.page.id}`,{method:'PATCH',token:f.owner.token,json}),f.context);
 expect((await send({title:'Missing state'})).status).toBe(400);
 const changed=await send({title:null,expectedState:f.page.state});expect(changed.status).toBe(200);const current=await changed.json();
 expect(current).toMatchObject({title:null,format:'html',version:f.page.version,html:f.page.html});expect(current.state).not.toBe(f.page.state);
 expect((await send({title:'Stale',expectedState:f.page.state})).status).toBe(409);
});
it.each(['markup','jsx','markdown','source','operations','annotation_ops'] as const)('rejects retired %s content fields at metadata admission',async field=>{
 const f=await fixture();const response=await patch(request(`/api/artifacts/${f.page.id}`,{method:'PATCH',token:f.owner.token,json:{expectedState:f.page.state,[field]:'<p>Legacy</p>'}}),f.context);
 expect(response.status).toBe(400);expect((await response.json()).error).toBe('native_html_required');
});
