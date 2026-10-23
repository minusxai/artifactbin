import { nativePublicationBody as documentPublicationBody,nativeSource } from './native-publication-fixture';
/**
 * Account-scoped resources through the REAL handlers: the profile, typed deletes over a mixed
 * workspace, remote sessions, dataset governance and what a reader may address.
 */

import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { GET,PATCH } from '@/app/api/account/profile/route';
import { GET as content } from '@/app/api/artifacts/[id]/content/route';
import { GET as read,PUT as replace } from '@/app/api/artifacts/[id]/route';
import { POST as create,GET as list } from '@/app/api/artifacts/route';
import { claimToken,createUser,has,identityForUser } from '@/lib/accounts';
import { createArtifact,getArtifactById,getSharingFor,updateSharingFor } from '@/lib/artifacts';
import { getDb } from '@/lib/platform';
import { expect,it } from 'vitest';
import { request,useAppHarness } from './harness';

useAppHarness();

describe('cli-account-resources', () => {
  it('profile settings and personal relationship lists commit together and reject stale proposals',async()=>{
   const user=await createUser({email:'mxmx_test_account_profile@example.com'}),other=await createUser({email:'mxmx_test_account_follow@example.com'});
   const token=await mintToken('mxmx_test_account_profile', user.id);await claimToken(user.id,token.token);
   const artifact=await createArtifact(token.id,user.id,{format:'html',source:nativeSource('<p>Like</p>'),meta:{},visibility:'private'});
   const read=await GET(request('/api/account/profile',{token:token.token}));expect(read.status).toBe(200);const profile=await read.json();expect(profile.type).toBe('profile');
   const body={...profile,username:'mxmx_test_profile_new',liked:[artifact.id],following:[other.id]};
   const updated=await PATCH(request('/api/account/profile',{method:'PATCH',token:token.token,json:body}));expect(updated.status).toBe(200);expect(await has(user.id,'like',artifact.id)).toBe(true);expect(await has(user.id,'follow',other.id)).toBe(true);
   const stale=await PATCH(request('/api/account/profile',{method:'PATCH',token:token.token,json:{...body,following:[]}}));expect(stale.status).toBe(409);expect(await has(user.id,'follow',other.id)).toBe(true);
   const invalid=await PATCH(request('/api/account/profile',{method:'PATCH',token:token.token,json:{...await updated.json(),username:'@invalid',following:[]}}));expect(invalid.status).toBe(400);expect(await has(user.id,'follow',other.id)).toBe(true);
  });
});


describe('cli-governance', () => {
  it('publishes content and explicit sharing in one creation and returns an editable governance snapshot',async()=>{
   const token=await mintToken('mxmx_test_cli_sharing');
   const shares=[{email:'mxmx_test_reader@example.com',role:'viewer'}];
   const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeSource('<p>Shared</p>'),shares}}));
   expect(response.status).toBe(201);const created=await response.json();
   expect((await getSharingFor(identityForUser(token.userId, token.id),created.id))?.shares).toEqual(shares);
   expect(created.shares).toEqual(shares);
   const snapshot=await read(request(`/api/artifacts/${created.id}`,{token:token.token}),{params:Promise.resolve({id:created.id})});
   expect((await snapshot.json()).shares).toEqual(shares);
  });

  it('invalid sharing refuses content creation rather than silently ignoring the grant',async()=>{
   const token=await mintToken('mxmx_test_cli_invalid_sharing');
   const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeSource('<p>Invalid sharing</p>'),shares:[{email:'invalid',role:'owner'}]}}));
   expect(response.status).toBe(400);
  });

  it('concurrent invitation changes invalidate observed-state writes without publishing stale content',async()=>{
   const token=await mintToken('mxmx_test_cli_share_race');const actor=identityForUser(token.userId, token.id);
   const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeSource('<p>Original</p>')}}));
   const {id}=await response.json();const base=(await getArtifactById(id))!;
   const shares=[{email:'mxmx_test_reader@example.com',role:'viewer' as const}];
   await updateSharingFor(actor,id,{shares});
   const result=await replace(request(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:documentPublicationBody(base,{html:nativeSource('<p>Stale write</p>'),shares:[]},true)}),{params:Promise.resolve({id})});
   expect(result.status).toBe(409);
   expect((await getArtifactById(id))?.source).toContain('Original');expect((await getSharingFor(actor,id))?.shares).toEqual(shares);
  });

  it('a conditional replacement commits content and invitation removal together',async()=>{
   const token=await mintToken('mxmx_test_cli_share_replace');const actor=identityForUser(token.userId, token.id);
   const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeSource('<p>Original</p>')}}));const {id}=await response.json();
   await updateSharingFor(actor,id,{shares:[{email:'mxmx_test_reader@example.com',role:'viewer'}]});
   const base=(await getArtifactById(id))!;
   const result=await replace(request(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:documentPublicationBody(base,{html:nativeSource('<p>Updated</p>'),shares:[]},true)}),{params:Promise.resolve({id})});
   expect(result.status).toBe(200);expect((await result.json()).shares).toEqual([]);
   expect((await getArtifactById(id))?.source).toContain('Updated');expect((await getSharingFor(actor,id))?.shares).toEqual([]);
  });
});

describe('cli-readable', () => {
  it('viewer CLI reads follow the same private sharing ACL without exposing invitations or gaining write access',async()=>{
   const ownerUser=await createUser({email:'mxmx_test_owner@example.com'}),readerUser=await createUser({email:'mxmx_test_reader@example.com'});
   const owner = await mintToken('mxmx_test_owner',ownerUser.id),reader=await mintToken('mxmx_test_reader',readerUser.id),stranger=await mintToken('mxmx_test_stranger');
    await claimToken(ownerUser.id,owner.token);await claimToken(readerUser.id,reader.token);
   const created=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:nativeSource('<p>Private content</p>'),visibility:'private',shares:[{email:readerUser.email,role:'viewer'}]}}));
   expect(created.status).toBe(201);const doc=await created.json();const path=`/api/artifacts/${doc.id}`,params={params:Promise.resolve({id:doc.id})};
   const response=await read(request(path,{token:reader.token}),params);expect(response.status).toBe(200);
   const snapshot=await response.json();expect(snapshot.html).toContain('Private content');expect(snapshot).not.toHaveProperty('shares');expect(snapshot.capabilities).toMatchObject({read:true,edit:false,sharing:false});
   expect((await read(request(path,{token:stranger.token}),params)).status).toBe(404);
   expect((await content(request(path+'/content',{token:reader.token}),params)).status).toBe(200);
   expect((await content(request(path+'/content',{token:stranger.token}),params)).status).toBe(404);
   expect((await replace(request(path,{method:'PUT',token:reader.token,json:documentPublicationBody((await getArtifactById(doc.id))!,{html:nativeSource('<p>Denied</p>')},true)}),params)).status).toBe(404);
  });

  it('public dataset snapshots expose rows but hide the source definition, policy and internal catalog from viewers',async()=>{
   const owner=await mintToken('mxmx_test_owner'),reader=await mintToken('mxmx_test_reader');
   const created=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{score:42}],visibility:'public'}}));
   expect(created.status).toBe(201);const doc=await created.json();
   const response=await read(request(`/api/artifacts/${doc.id}`,{token:reader.token}),{params:Promise.resolve({id:doc.id})});expect(response.status).toBe(200);
   const snapshot=await response.json();expect(snapshot.rows).toEqual([{score:42}]);expect(snapshot).not.toHaveProperty('html');expect(snapshot).not.toHaveProperty('dataset_policy');expect(snapshot).not.toHaveProperty('shares');expect(JSON.stringify(snapshot.meta)).not.toContain('objectKey');
  });

  it('editing another invitation preserves an existing grant bound to an account after its email changes',async()=>{
   const ownerUser=await createUser({email:'mxmx_test_sticky_owner@example.com'}),readerUser=await createUser({email:'mxmx_test_old_address@example.com'});
   const owner = await mintToken('mxmx_test_sticky_owner',ownerUser.id),reader=await mintToken('mxmx_test_sticky_reader',readerUser.id);
    await claimToken(ownerUser.id,owner.token);await claimToken(readerUser.id,reader.token);
   const initial=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:nativeSource('<p>Account bound</p>'),visibility:'private',shares:[{email:readerUser.email,role:'viewer'}]}}));const doc=await initial.json();const context={params:Promise.resolve({id:doc.id})},path=`/api/artifacts/${doc.id}`;
   expect((await read(request(path,{token:reader.token}),context)).status).toBe(200);
   await (await getDb()).query('UPDATE users SET email=$2 WHERE id=$1',[readerUser.id,'mxmx_test_new_address@example.com']);
   const head=await (await read(request(path,{token:owner.token}),context)).json();
   const changed=await replace(request(path,{method:'PUT',token:owner.token,json:documentPublicationBody((await getArtifactById(doc.id))!,{html:head.html,shares:[{email:readerUser.email,role:'viewer'},{email:'mxmx_test_another@example.com',role:'viewer'}]},true)}),context);expect(changed.status).toBe(200);
   expect((await read(request(path,{token:reader.token}),context)).status).toBe(200);
   const newcomer=await createUser({email:readerUser.email}),token=await mintToken('mxmx_test_reused_email',newcomer.id);await claimToken(newcomer.id,token.token);
   expect((await read(request(path,{token:token.token}),context)).status).toBe(404);
  });

  it('native collections include explicit viewer shares and filter before paging without listing unrelated public resources',async()=>{
   const ownerUser=await createUser({email:'mxmx_test_collection_owner@example.com'}),readerUser=await createUser({email:'mxmx_test_collection_reader@example.com'});
   const owner = await mintToken('mxmx_test_collection_owner',ownerUser.id),reader=await mintToken('mxmx_test_collection_reader',readerUser.id);
    await claimToken(ownerUser.id,owner.token);await claimToken(readerUser.id,reader.token);
   const shared=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{n:1}],title:'Quarterly Sales',visibility:'private',shares:[{email:readerUser.email,role:'viewer'}]}}));expect(shared.status).toBe(201);const sharedId=(await shared.json()).id;
   await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:nativeSource('<p>Unrelated public</p>'),visibility:'public'}}));
   await create(request('/api/artifacts',{method:'POST',token:reader.token,json:{html:nativeSource('<p>Owned</p>'),title:'Owned'}}));
   const filtered=await list(request('/api/artifacts?type=dataset&relationship=shared&search=sales&limit=1',{token:reader.token}));expect(filtered.status).toBe(200);expect((await filtered.json()).artifacts.map((r:{id:string})=>r.id)).toEqual([sharedId]);
   const all=await list(request('/api/artifacts',{token:reader.token}));expect((await all.json()).artifacts).toHaveLength(2);
   const invalid=await list(request('/api/artifacts?relationship=everyone',{token:reader.token}));expect(invalid.status).toBe(400);
  });
});
