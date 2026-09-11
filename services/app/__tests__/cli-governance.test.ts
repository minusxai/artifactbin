import {expect,it} from 'vitest';
import {request,useAppHarness} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as read,PUT as replace} from '@/app/api/artifacts/[id]/route';
import {mintToken} from '@/lib/tokens';
import {getArtifactById,getSharingFor,updateSharingFor} from '@/lib/artifacts';
import {artifactState} from '@/lib/artifact-state';
useAppHarness();

it('publishes content and explicit sharing in one creation and returns an editable governance snapshot',async()=>{
 const token=await mintToken('mxmx_test_cli_sharing');
 const shares=[{email:'mxmx_test_reader@example.com',role:'viewer'}];
 const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Shared</p>',shares}}));
 expect(response.status).toBe(201);const created=await response.json();
 expect((await getSharingFor({tokenId:token.id,userId:null},created.id))?.shares).toEqual(shares);
 expect(created.shares).toEqual(shares);
 const snapshot=await read(request(`/api/artifacts/${created.id}`,{token:token.token}),{params:Promise.resolve({id:created.id})});
 expect((await snapshot.json()).shares).toEqual(shares);
});

it('invalid sharing refuses content creation rather than silently ignoring the grant',async()=>{
 const token=await mintToken('mxmx_test_cli_invalid_sharing');
 const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Invalid sharing</p>',shares:[{email:'invalid',role:'owner'}]}}));
 expect(response.status).toBe(400);
});

it('concurrent invitation changes invalidate observed-state writes without publishing stale content',async()=>{
 const token=await mintToken('mxmx_test_cli_share_race');const actor={tokenId:token.id,userId:null};
 const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Original</p>'}}));
 const {id}=await response.json();const base=(await getArtifactById(id))!;
 const shares=[{email:'mxmx_test_reader@example.com',role:'viewer' as const}];
 await updateSharingFor(actor,id,{shares});
 const result=await replace(request(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:{markup:'<p>Stale write</p>',shares:[],expectedVersion:base.version,expectedState:artifactState(base)}}),{params:Promise.resolve({id})});
 expect(result.status).toBe(409);
 expect((await getArtifactById(id))?.source).toContain('Original');expect((await getSharingFor(actor,id))?.shares).toEqual(shares);
});

it('a conditional replacement commits content and invitation removal together',async()=>{
 const token=await mintToken('mxmx_test_cli_share_replace');const actor={tokenId:token.id,userId:null};
 const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Original</p>'}}));const {id}=await response.json();
 await updateSharingFor(actor,id,{shares:[{email:'mxmx_test_reader@example.com',role:'viewer'}]});
 const base=(await getArtifactById(id))!;
 const result=await replace(request(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:{markup:'<p>Updated</p>',shares:[],expectedVersion:base.version,expectedState:artifactState(base)}}),{params:Promise.resolve({id})});
 expect(result.status).toBe(200);expect((await result.json()).shares).toEqual([]);
 expect((await getArtifactById(id))?.source).toContain('Updated');expect((await getSharingFor(actor,id))?.shares).toEqual([]);
});
