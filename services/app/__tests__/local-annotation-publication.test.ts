import {it,expect} from 'vitest';
import {useAppHarness,request} from '@/__tests__/harness';
import { createUser, claimToken } from '@/lib/accounts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {POST as createArtifact} from '@/app/api/artifacts/route';
import {POST as createComment,GET as listComments} from '@/app/api/artifacts/[id]/annotations/route';
import {POST as actOnComment} from '@/app/api/artifacts/[id]/annotations/[annId]/route';
useAppHarness();
const params=(value:Record<string,string>)=>({params:Promise.resolve(value)});
async function fixture(){const user = await createUser({email:'mxmx_test_local_comments@example.com'}); const token = await mintToken('offline-publication', user.id);await claimToken(user.id,token.token);const made=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p id="p001">One paragraph.</p>'}}));expect(made.status).toBe(201);return{token:token.token,user,id:(await made.json()).id};}
it('HTTP comment creation retains node, selected words and range while attributing the authenticated account',async()=>{
 const f=await fixture();const range={v:1,parts:[{rel:'',start:4,end:13,text:'paragraph'}]};const response=await createComment(request(`/api/artifacts/${f.id}/annotations`,{method:'POST',token:f.token,json:{node_id:'p001',quote:'paragraph',range,body:'Offline note'}}),params({id:f.id}));expect(response.status,await response.clone().text()).toBe(201);const annotation=await response.json();expect(annotation.quote).toBe('paragraph');expect(annotation.range).toEqual(range);expect(annotation.thread[0].author).toMatchObject({kind:'agent',transport:'http',user_id:null});
});
it('concurrent annotation changes use revision CAS and rejected replies leave the conversation unchanged',async()=>{
 const f=await fixture();const created=await createComment(request(`/api/artifacts/${f.id}/annotations`,{method:'POST',token:f.token,json:{node_id:'p001',body:'First'}}),params({id:f.id}));expect(created.status).toBe(201);const annotation=await created.json();
 const invoke=(reply:string)=>actOnComment(request(`/api/artifacts/${f.id}/annotations/${annotation.id}`,{method:'POST',token:f.token,json:{reply,resolve:true,expected_revision:annotation.revision}}),params({id:f.id,annId:annotation.id}));const responses=await Promise.all([invoke('First concurrent reply'),invoke('Second concurrent reply')]);expect(responses.map(response=>response.status).sort()).toEqual([200,409]);const rejected=responses.find(response=>response.status===409)!;expect((await rejected.json()).error).toBe('annotation_conflict');
 const listed=await listComments(request(`/api/artifacts/${f.id}/annotations?status=all`,{token:f.token}),params({id:f.id}));const value=(await listed.json()).annotations[0];expect(value.thread).toHaveLength(2);expect(value.status).toBe('resolved');expect(value.revision).toBe(annotation.revision+1);
});
