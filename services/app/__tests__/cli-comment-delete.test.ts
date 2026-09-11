/** The bearer comment DELETE door mirrors the browser door's ACL: account-claimed governors only. */
import {expect,it} from 'vitest';
import {useAppHarness,request} from './harness';
import {mintToken} from '@/lib/tokens';
import {createUser,claimToken} from '@/lib/users';
import {createArtifact} from '@/lib/artifacts';
import {POST as create} from '@/app/api/artifacts/[id]/annotations/route';
import {GET} from '@/app/api/artifacts/[id]/annotations/route';
import {DELETE as remove} from '@/app/api/artifacts/[id]/annotations/[annId]/route';
useAppHarness();
it('deletes a thread for an account-claimed owner, refuses anonymous tokens and outsiders, and answers 404 on repeat',async()=>{
 const user=await createUser({email:'mxmx_test_comment_delete@example.com'});
 const token=await mintToken('mxmx_test_comment_delete');await claimToken(user.id,token.token);
 const row=await createArtifact(token.id,user.id,{title:'delete',format:'markup',content:'',source:'<p id="paragraph">Text</p>',meta:{}});
 const ctx={params:Promise.resolve({id:row.id})};
 const made=await create(request(`/api/artifacts/${row.id}/annotations`,{method:'POST',token:token.token,json:{node_id:'paragraph',body:'Remove me'}}),ctx);expect(made.status).toBe(201);
 const annId=(await made.json()).id as string;
 const annCtx={params:Promise.resolve({id:row.id,annId})};
 const anonymous=await mintToken('mxmx_test_comment_anon');
 expect((await remove(request(`/api/artifacts/${row.id}/annotations/${annId}`,{method:'DELETE',token:anonymous.token}),annCtx)).status).toBe(403);
 const outsider=await createUser({email:'mxmx_test_comment_outsider@example.com'});const outsiderToken=await mintToken('mxmx_test_comment_outsider');await claimToken(outsider.id,outsiderToken.token);
 expect((await remove(request(`/api/artifacts/${row.id}/annotations/${annId}`,{method:'DELETE',token:outsiderToken.token}),annCtx)).status).toBe(404);
 expect((await remove(request(`/api/artifacts/${row.id}/annotations/${annId}`,{method:'DELETE',token:token.token}),annCtx)).status).toBe(200);
 expect((await remove(request(`/api/artifacts/${row.id}/annotations/${annId}`,{method:'DELETE',token:token.token}),annCtx)).status).toBe(404);
 const listed=await GET(request(`/api/artifacts/${row.id}/annotations`,{token:token.token}),ctx);expect((await listed.json()).annotations).toHaveLength(0);
});
