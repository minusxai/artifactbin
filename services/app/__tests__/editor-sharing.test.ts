import {expect,it} from 'vitest';
import {agentCookie,request,useAppHarness} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as read,PUT as write} from '@/app/api/my/artifacts/[id]/sharing/route';
import {observedRequest} from './conditional-request';
import {DELETE as remove,PATCH as metadata} from '@/app/api/my/artifacts/[id]/route';
import {POST as restore} from '@/app/api/my/artifacts/[id]/restore/route';
import {getArtifactById,effectiveRole,updateSharingFor} from '@/lib/artifacts';
import {createUser,claimToken} from '@/lib/users';
import {mintToken} from '@/lib/tokens';
useAppHarness();
const params=(id:string)=>({params:Promise.resolve({id})});
async function person(name:string){
 const user=await createUser({email:`mxmx_test_${name}@example.com`}),token=await mintToken(name);
 await claimToken(user.id,token.token);
 return {user,token,actor:{userId:user.id,tokenId:token.id},cookie:await agentCookie([token.id])};
}
async function fixture(role:'viewer'|'commenter'|'editor',dataset=false){
 const owner=await person('sharing_owner'),editor=await person('sharing_editor');
 const r=await create(request('/api/artifacts',{method:'POST',token:owner.token.token,json:{...(dataset?{dataset:[{n:1}]}:{markup:'<p>shared</p>'}),visibility:'private'}}));
 expect(r.status).toBe(201);const {id}=await r.json();
 await updateSharingFor(owner.actor,id,{shares:[{email:editor.user.email,role}]});
 const save=(json:object)=>write(request(`/api/my/artifacts/${id}/sharing`,{method:'PUT',cookie:editor.cookie,json}),params(id));
 return {owner,editor,id,save};
}
it.each(['viewer','commenter','editor'] as const)('sharing management requires edit access: %s',async role=>{
 const f=await fixture(role);
 expect((await read(request(`/api/my/artifacts/${f.id}/sharing`,{cookie:f.editor.cookie}),params(f.id))).status).toBe(role==='editor'?200:404);
 for(const granted of ['viewer','commenter','editor'] as const){
  const r=await f.save({shares:[{email:f.editor.user.email,role},{email:'mxmx_test_recipient@example.com',role:granted}],visibility:'unlisted',linkRole:granted});
  expect(r.status).toBe(role==='editor'?200:404);
  if(role==='editor')expect(await r.json()).toMatchObject({visibility:'unlisted',linkRole:granted,shares:expect.arrayContaining([{email:'mxmx_test_recipient@example.com',role:granted}])});
 }
});
it('editors may remove shares, including their own, but cannot demote the owner',async()=>{
 const f=await fixture('editor');
 const r=await f.save({shares:[{email:f.owner.user.email,role:'viewer'}]});
 expect(r.status).toBe(200);
 const row=(await getArtifactById(f.id))!;
 expect(row.user_id).toBe(f.owner.user.id);
 expect(await effectiveRole(row,f.owner.actor)).toBe('owner');
 expect((await f.save({visibility:'public'})).status).toBe(404);
});
it('editors can configure writable datasets through sharing',async()=>{
 const f=await fixture('editor',true);
 expect((await f.save({access:'readwrite'})).status).toBe(200);
 expect((await getArtifactById(f.id))?.access).toBe('readwrite');
});
it('ownership, deletion and restoration remain outside editor sharing authority',async()=>{
 const f=await fixture('editor');
 expect((await f.save({shares:[{email:f.editor.user.email,role:'owner'}]})).status).toBe(400);
 expect((await remove(request(`/api/my/artifacts/${f.id}`,{method:'DELETE',cookie:f.editor.cookie}),params(f.id))).status).toBe(404);
 expect((await remove(request(`/api/my/artifacts/${f.id}`,{method:'DELETE',cookie:f.owner.cookie}),params(f.id))).status).toBe(200);
 expect((await restore(request(`/api/my/artifacts/${f.id}/restore`,{method:'POST',cookie:f.editor.cookie}),params(f.id))).status).toBe(404);
 expect((await restore(request(`/api/my/artifacts/${f.id}/restore`,{method:'POST',cookie:f.owner.cookie}),params(f.id))).status).toBe(200);
 expect((await getArtifactById(f.id))?.user_id).toBe(f.owner.user.id);
});

it('editors can change link access through the metadata API',async()=>{
 const f=await fixture('editor');
 const r=await metadata(await observedRequest(`/api/my/artifacts/${f.id}`,{method:'PATCH',cookie:f.editor.cookie,json:{visibility:'unlisted',linkRole:'commenter'}}),params(f.id));
 expect(r.status).toBe(200);
 expect((await getArtifactById(f.id))?.link_role).toBe('commenter');
});

it('a link editor may apply one atomic patch that removes their access',async()=>{
 const f=await fixture('editor',true);
 await updateSharingFor(f.owner.actor,f.id,{visibility:'public',linkRole:'editor',shares:[]});
 const r=await f.save({visibility:'private',linkRole:'viewer',access:'readwrite'});
 expect(r.status).toBe(200);
 expect(await r.json()).toMatchObject({visibility:'private',linkRole:'viewer',access:'readwrite'});
 expect(await getArtifactById(f.id)).toMatchObject({visibility:'private',link_role:'viewer',access:'readwrite'});
});
