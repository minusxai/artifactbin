import {it,expect} from 'vitest';
import {useAppHarness,request} from './harness';
import {mintToken} from '@/lib/tokens';
import {createUser,claimToken} from '@/lib/users';
import {createArtifact} from '@/lib/artifacts';
import {has} from '@/lib/relations';
import {GET,PATCH} from '@/app/api/account/profile/route';
useAppHarness();
it('profile settings and personal relationship lists commit together and reject stale proposals',async()=>{
 const user=await createUser({email:'mxmx_test_account_profile@example.com'}),other=await createUser({email:'mxmx_test_account_follow@example.com'});
 const token=await mintToken('mxmx_test_account_profile');await claimToken(user.id,token.token);
 const artifact=await createArtifact(token.id,user.id,{format:'markup',source:'<p>Like</p>',content:'',meta:{},visibility:'private'});
 const read=await GET(request('/api/account/profile',{token:token.token}));expect(read.status).toBe(200);const profile=await read.json();expect(profile.type).toBe('profile');
 const body={...profile,username:'mxmx_test_profile_new',liked:[artifact.id],following:[other.id]};
 const updated=await PATCH(request('/api/account/profile',{method:'PATCH',token:token.token,json:body}));expect(updated.status).toBe(200);expect(await has(user.id,'like',artifact.id)).toBe(true);expect(await has(user.id,'follow',other.id)).toBe(true);
 const stale=await PATCH(request('/api/account/profile',{method:'PATCH',token:token.token,json:{...body,following:[]}}));expect(stale.status).toBe(409);expect(await has(user.id,'follow',other.id)).toBe(true);
 const invalid=await PATCH(request('/api/account/profile',{method:'PATCH',token:token.token,json:{...await updated.json(),username:'@invalid',following:[]}}));expect(invalid.status).toBe(400);expect(await has(user.id,'follow',other.id)).toBe(true);
});
