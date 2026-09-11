import {expect,it} from 'vitest';
import {request,useAppHarness} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as read,PUT as replace} from '@/app/api/artifacts/[id]/route';
import {GET as content} from '@/app/api/artifacts/[id]/content/route';
import {mintToken} from '@/lib/tokens';
import {claimToken,createUser} from '@/lib/users';
useAppHarness();

it('viewer CLI reads follow the same private sharing ACL without exposing invitations or gaining write access',async()=>{
 const owner=await mintToken('mxmx_test_owner'),reader=await mintToken('mxmx_test_reader'),stranger=await mintToken('mxmx_test_stranger');
 const ownerUser=await createUser({email:'mxmx_test_owner@example.com'}),readerUser=await createUser({email:'mxmx_test_reader@example.com'});
 await claimToken(ownerUser.id,owner.token);await claimToken(readerUser.id,reader.token);
 const created=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{markup:'<p>Private content</p>',visibility:'private',shares:[{email:readerUser.email,role:'viewer'}]}}));
 expect(created.status).toBe(201);const doc=await created.json();const path=`/api/artifacts/${doc.id}`,params={params:Promise.resolve({id:doc.id})};
 const response=await read(request(path,{token:reader.token}),params);expect(response.status).toBe(200);
 const snapshot=await response.json();expect(snapshot.markup).toContain('Private content');expect(snapshot).not.toHaveProperty('shares');expect(snapshot.capabilities).toMatchObject({read:true,edit:false,sharing:false});
 expect((await read(request(path,{token:stranger.token}),params)).status).toBe(404);
 expect((await content(request(path+'/content',{token:reader.token}),params)).status).toBe(200);
 expect((await content(request(path+'/content',{token:stranger.token}),params)).status).toBe(404);
 expect((await replace(request(path,{method:'PUT',token:reader.token,json:{markup:'<p>Denied</p>',expectedState:doc.state,expectedVersion:doc.version}}),params)).status).toBe(404);
});

it('public dataset snapshots expose rows but hide the source definition, policy and internal catalog from viewers',async()=>{
 const owner=await mintToken('mxmx_test_owner'),reader=await mintToken('mxmx_test_reader');
 const created=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{score:42}],visibility:'public'}}));
 expect(created.status).toBe(201);const doc=await created.json();
 const response=await read(request(`/api/artifacts/${doc.id}`,{token:reader.token}),{params:Promise.resolve({id:doc.id})});expect(response.status).toBe(200);
 const snapshot=await response.json();expect(snapshot.rows).toEqual([{score:42}]);expect(snapshot.markup).toBeNull();expect(snapshot).not.toHaveProperty('dataset_policy');expect(snapshot).not.toHaveProperty('shares');expect(JSON.stringify(snapshot.meta)).not.toContain('objectKey');
});
