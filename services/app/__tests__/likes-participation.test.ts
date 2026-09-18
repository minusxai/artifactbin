import {services} from '@/lib/services';
import {expect,it,vi} from 'vitest';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as mutate} from '@/app/a/[id]/mutate/route';
import {POST as directMutation} from '@/app/api/artifacts/[id]/mutate/route';
import {dataflowForRow,getArtifactById,forkArtifact} from '@/lib/artifacts';
import {mintToken} from '@/lib/tokens';
import {claimToken,createUser} from '@/lib/users';
import {count,has,link,unlink} from '@/lib/relations';
import {accountProfile,updateAccountProfile} from '@/lib/account-profile';
import {loadDatasetRows} from '@/lib/story/dataset-store';
import {request,useAppHarness} from './harness';
useAppHarness();
const ctx=(id:string)=>({params:Promise.resolve({id})});
async function account(label:string){const user=await createUser({email:`mxmx_test_likes_${label}@example.com`});const token=await mintToken(label);await claimToken(user.id,token.token);return {user,token};}
async function publish(token:string,body:object){const response=await create(request('/api/artifacts',{method:'POST',token,json:body}));expect(response.status,await response.clone().text()).toBe(201);return (await response.json()).id as string;}
it('auto-likes for the owner without inflating social counts or the liked list',async()=>{
 const a=await account('owner');const id=await publish(a.token.token,{markup:'<p>App</p>'});
 expect(await has(a.user.id,'like',id)).toBe(true);
 expect(await count('like',id)).toBe(0);
 expect((await accountProfile(a.user.id))!.liked).not.toContain(id);
});
it('scopes live query members and mutation reads to the page, retaining rows after unlike',async()=>{
 const a=await account('owner'),b=await account('friend');
 const ds=await publish(a.token.token,{dataset:[{who:null}],columns:[{name:'who',type:'user',constraints:{memberOf:['_likes']}}],access:'readwrite'});
 const markup=`<Helmet><Query name="members">{\`select "user" from _likes order by "user"\`}</Query><Query name="saved" source="ref:${ds}">{\`select * from public.rows\`}</Query><Mutation name="add" source="ref:${ds}">{\`insert into public.rows select "user" from _likes where "user"=$_me\`}</Mutation></Helmet><Button run="$add">Add</Button><DataTable data="$members"/>`;
 const first=await publish(a.token.token,{markup}),second=await publish(a.token.token,{markup});
 await link(b.user.id,'like',first);
 const members=async(id:string)=>(await dataflowForRow((await getArtifactById(id))!))!.state.tables.members.rows;
 expect(await members(first)).toHaveLength(2);expect(await members(second)).toEqual([{user:a.user.id}]);
 const result=await mutate(request(`/a/${first}/mutate`,{method:'POST',token:a.token.token,json:{mutation:'add'}}),ctx(first));
 expect(result.status,await result.clone().text()).toBe(200);
 const before=await loadDatasetRows((await getArtifactById(ds))!);
 await unlink(a.user.id,'like',first);
 expect(await loadDatasetRows((await getArtifactById(ds))!)).toEqual(before);
 const invalid=await directMutation(request(`/api/artifacts/${ds}/mutate`,{method:'POST',token:a.token.token,json:{sql:'insert into public.rows values ($_me)'}}),ctx(ds));
 expect(invalid.status,await invalid.clone().text()).toBe(403);
});

it('keeps the hidden owner like through a profile roundtrip',async()=>{
 const a=await account('profile');const id=await publish(a.token.token,{markup:'<p>Owned</p>'});
 const profile=(await accountProfile(a.user.id))!;
 const result=await updateAccountProfile({tokenId:a.token.id,userId:a.user.id},{...profile,liked:[]});
 expect(result.status).toBe(200);expect(await has(a.user.id,'like',id)).toBe(true);
});
it('rechecks an unlike between SQL execution and commit',async()=>{
 const a=await account('race');
 const ds=await publish(a.token.token,{dataset:[{who:null}],columns:[{name:'who',type:'user',constraints:{memberOf:['_likes']}}],access:'readwrite'});
 const id=await publish(a.token.token,{markup:`<Helmet><Mutation name="add" source="ref:${ds}">{\`insert into public.rows select "user" from _likes where "user"=$_me\`}</Mutation></Helmet><Button run="$add">Add</Button>`});
 const sql=services().sql,run=sql.mutate.bind(sql);let removed=false;
 const spy=vi.spyOn(sql,'mutate').mockImplementation(async input=>{const result=await run(input);if(input.likes&&!input.policyPreview&&!removed){removed=true;await unlink(a.user.id,'like',id);}return result;});
 try {
  const response=await mutate(request(`/a/${id}/mutate`,{method:'POST',token:a.token.token,json:{mutation:'add'}}),ctx(id));
  expect(response.status,await response.clone().text()).toBe(200);
  expect(removed).toBe(true);
  expect(await loadDatasetRows((await getArtifactById(ds))!)).toEqual([{who:null}]);
 }finally{spy.mockRestore();}
});
it('forks frozen likes constraints into the new page and never writes original datasets',async()=>{
 const a=await account('forker'),b=await account('copyowner');
 const ds=await publish(a.token.token,{dataset:[{who:null}],columns:[{name:'who',type:'user',constraints:{memberOf:['_likes']}}],access:'readwrite'});
 const id=await publish(a.token.token,{visibility:'public',markup:`<Helmet><Mutation name="add" source="ref:${ds}">{\`insert into public.rows values ($_me)\`}</Mutation></Helmet><Button run="$add">Add</Button>`});
 const fork=await forkArtifact({tokenId:b.token.id,userId:b.user.id},(await getArtifactById(id))!);
 expect(fork).not.toBeInstanceOf(Response);if(fork instanceof Response)return;
 expect(fork.datasets).toHaveLength(1);
 const copy=(await getArtifactById(fork.datasets[0].id))!;
 expect(JSON.stringify(copy.meta)).toContain(`likes:${fork.artifact.id}`);
 expect(JSON.stringify(copy.meta)).not.toContain(`likes:${id}`);
 const response=await mutate(request(`/a/${fork.artifact.id}/mutate`,{method:'POST',token:b.token.token,json:{mutation:'add'}}),ctx(fork.artifact.id));
 expect(response.status,await response.clone().text()).toBe(200);
 expect(await loadDatasetRows((await getArtifactById(ds))!)).toEqual([{who:null}]);
});
it('uses Sign in for guest identity actions and rejects forged likes in a request',async()=>{
 const a=await account('guest');
 const ds=await publish(a.token.token,{dataset:[{who:null}],columns:[{name:'who',type:'user'}],access:'readwrite'});
 const id=await publish(a.token.token,{visibility:'public',markup:`<Helmet><Mutation name="add" source="ref:${ds}">{\`insert into public.rows values ($_me)\`}</Mutation></Helmet><Button run="$add">Add</Button>`});
 const state=(await dataflowForRow((await getArtifactById(id))!))!.state;
 expect(state.mutationAccess?.add).toBe('sign_in_required');
 const response=await mutate(request(`/a/${id}/mutate`,{method:'POST',json:{mutation:'add',likes:[a.user.id],values:{_me:a.user.id}}}),ctx(id));
 expect(response.status).toBe(403);
 expect(await loadDatasetRows((await getArtifactById(ds))!)).toEqual([{who:null}]);
});
