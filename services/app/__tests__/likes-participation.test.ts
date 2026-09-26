import {expect,it} from 'vitest';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as mutate} from '@/app/a/[id]/mutate/route';
import {dataflowForRow,getArtifactById} from '@/lib/artifacts';
import {mintToken} from '@/lib/tokens';
import {claimToken,createUser} from '@/lib/users';
import {count,has,link} from '@/lib/relations';
import {accountProfile} from '@/lib/account-profile';
import {loadDatasetRows} from '@/lib/story/dataset-store';
import {request,useAppHarness} from './harness';
useAppHarness();
const ctx=(id:string)=>({params:Promise.resolve({id})});
async function account(label:string){const user=await createUser({email:`mxmx_test_likes_${label}@example.com`});const token=await mintToken(label);await claimToken(user.id,token.token);return {user,token};}
async function publish(token:string,body:object){const response=await create(request('/api/artifacts',{method:'POST',token,json:body}));expect(response.status,await response.clone().text()).toBe(201);return (await response.json()).id as string;}
it('creates and claims artifacts without automatically liking them',async()=>{
 const a=await account('owner');const id=await publish(a.token.token,{markup:'<p>App</p>'});
 expect(await has(a.user.id,'like',id)).toBe(false);
 expect(await count('like',id)).toBe(0);
 const anonymous=await mintToken('unclaimed');
 const claimed=await publish(anonymous.token,{markup:'<p>Claimed</p>'});
 await claimToken(a.user.id,anonymous.token);
 expect(await has(a.user.id,'like',claimed)).toBe(false);
 await link(a.user.id,'like',id);
 expect(await count('like',id)).toBe(1);
 expect((await accountProfile(a.user.id))!.liked).toContain(id);
});
it('does not provide an implicit likes query table or membership scope',async()=>{
 const a=await account('namespace');
 const query=await create(request('/api/artifacts',{method:'POST',token:a.token.token,json:{markup:'<Helmet><Query name="members">{`select * from _likes`}</Query></Helmet><DataTable data="$members" />'}}));
 expect(query.status).toBe(400);
 for(const scope of ['_likes','likes:abc123']){
  const response=await create(request('/api/artifacts',{method:'POST',token:a.token.token,json:{dataset:[{who:null}],columns:[{name:'who',type:'user',constraints:{memberOf:[scope]}}]}}));
  expect(response.status).toBe(400);
 }
});
it('uses Sign in for guest identity actions and rejects forged likes in a request',async()=>{
 const a=await account('guest');
 const ds=await publish(a.token.token,{dataset:[{who:null}],columns:[{name:'who',type:'user'}],access:'readwrite'});
 const id=await publish(a.token.token,{visibility:'public',markup:`<Helmet><Import name="add_data" src="ref:${ds}" /><Mutation name="add">{\`insert into add_data.rows values ($_me.id)\`}</Mutation></Helmet><Button run="$add">Add</Button>`});
 const state=(await dataflowForRow((await getArtifactById(id))!))!.state;
 expect(state.mutationAccess?.add).toBe('sign_in_required');
 const response=await mutate(request(`/a/${id}/mutate`,{method:'POST',json:{mutation:'add',likes:[a.user.id],args:{_me:a.user.id}}}),ctx(id));
 expect(response.status).toBe(403);
 expect(await loadDatasetRows((await getArtifactById(ds))!)).toEqual([{who:null}]);
});
