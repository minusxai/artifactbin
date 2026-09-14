import {POST as documentMutation} from '@/app/a/[id]/mutate/route';
import {describe, expect, it} from 'vitest';
import {POST as createRoute} from '@/app/api/artifacts/route';
import {PUT as replaceRoute} from '@/app/api/artifacts/[id]/route';
import {observedRequest} from '@/__tests__/conditional-request';
import {POST as mutateRoute} from '@/app/api/artifacts/[id]/mutate/route';
import {getArtifactById,dataflowForRow,setMetadataFor} from '@/lib/artifacts';
import {loadDatasetRows} from '@/lib/story/dataset-store';
import {mintToken} from '@/lib/tokens';
import {claimToken, createUser} from '@/lib/users';
import {useAppHarness, request} from '@/__tests__/harness';

useAppHarness();
const ctx = (id:string)=>({params:Promise.resolve({id})});
async function account(name:string) {
 const token=await mintToken(name);
 const user=await createUser({email:`mxmx_test_${name}@example.com`,name});
 await claimToken(user.id,token.token);
 return {token:token.token,tokenId:token.id,user};
}
async function create(token:string,body:Record<string,unknown>) {
 const response=await createRoute(request('/api/artifacts',{method:'POST',token,json:body}));
 expect(response.status,await response.clone().text()).toBe(201);
 return response.json() as Promise<{id:string}>;
}
async function mutate(token:string,id:string,sql:string,values:Record<string,unknown>={}) {
 return mutateRoute(request(`/api/artifacts/${id}/mutate`,{method:'POST',token,json:{sql,values}}),ctx(id));
}
describe('native user fields',()=>{
 it('validates real assigned values, binds $_me, and leaves historical self fields alone',async()=>{
  const a=await account('owner'), b=await account('other');
  const dataset=await create(a.token,{dataset:[{id:1,done_by:null,title:'First'}],columns:[{name:'done_by',type:'user',constraints:{self:true}}],access:'readwrite'});
  const bad=await mutate(a.token,dataset.id,`update public.rows set done_by='${b.user.id}'`);
  expect(bad.status).toBe(403);
  expect((await loadDatasetRows((await getArtifactById(dataset.id))!))[0].done_by).toBeNull();
  const good=await mutate(a.token,dataset.id,'update public.rows set done_by=$_me',{_me:b.user.id});
  expect(good.status,await good.clone().text()).toBe(200);
  expect((await loadDatasetRows((await getArtifactById(dataset.id))!))[0].done_by).toBe(a.user.id);
  expect((await getArtifactById(dataset.id))!.meta.columns).toContainEqual({name:'done_by',type:'user',constraints:{self:true}});
 });
 it('uses union membership, rejects unknown users and enforces replacements',async()=>{
  const a=await account('owner'), b=await account('member'), c=await account('outsider');
  const report=await create(a.token,{markup:'<h1>Project</h1>',shares:[{email:b.user.email,role:'viewer'}]});
  const dataset=await create(a.token,{dataset:[{id:1,assignee:null}],columns:[{name:'assignee',type:'user',constraints:{memberOf:[`ref:${report.id}`]}}],access:'readwrite'});
  expect((await mutate(a.token,dataset.id,`update public.rows set assignee='${b.user.id}'`)).status).toBe(200);
  expect((await mutate(a.token,dataset.id,`update public.rows set assignee='${c.user.id}'`)).status).toBe(403);
  expect((await mutate(a.token,dataset.id,"update public.rows set assignee='usr_missing'")).status).toBe(403);
 });
 it('freezes current on first report attachment and supplies typed member choices',async()=>{
  const a=await account('owner'), b=await account('member');
  const dataset=await create(a.token,{dataset:{kind:'stored',tables:[{schema:'public',name:'rows',columns:[{name:'id',type:'number'},{name:'assignee',type:'user',constraints:{memberOf:['current']}}],rows:[{id:1,assignee:null}]}]},access:'readwrite'});
  const markup=`<Helmet><Value name="person" source="ref:${dataset.id}" column="assignee" /><Query name="tasks" source="ref:${dataset.id}">{\`select id,assignee as assigned,upper(assignee) as text_only from public.rows where $person is null or assignee=$person order by id\`}</Query></Helmet><Select value="$person" label="Person" /><DataTable data="$tasks" />`;
  const report=await create(a.token,{markup,shares:[{email:b.user.email,role:'viewer'}]});
  const column=(await getArtifactById(dataset.id))!.meta.columns as Array<{constraints?:{memberOf:string[]}}>;
  expect(column[1].constraints?.memberOf).toEqual([`ref:${report.id}`]);
  const flow=await dataflowForRow((await getArtifactById(report.id))!,{viewer:{userId:a.user.id,tokenId:a.tokenId,email:a.user.email}});
  expect(flow?.state.errors).toEqual({});
  expect(flow?.state.tables.tasks.columns).toContainEqual({name:'assigned',type:'user',constraints:{memberOf:[`ref:${report.id}`]}});
  expect(flow?.state.tables.tasks.columns).toContainEqual({name:'text_only',type:'string'});
  expect(flow?.state.userOptions?.['tasks.assigned'].map(o=>o.value).sort()).toEqual([a.user.id,b.user.id].sort());
  expect(flow?.state.userOptions?.person).toHaveLength(2);
  await create(a.token,{markup});
  expect(((await getArtifactById(dataset.id))!.meta.columns as typeof column)[1].constraints?.memberOf).toEqual([`ref:${report.id}`]);
 });
 it('keeps historical self values but rejects explicit unchanged assignments by another writer',async()=>{
  const a=await account('owner'), b=await account('editor');
  const columns=[{name:'done_by',type:'user',constraints:{self:true}}];
  const dataset=await create(a.token,{dataset:[{id:1,done_by:a.user.id,title:'First'}],columns,access:'readwrite',shares:[{email:b.user.email,role:'editor'}]});
  expect((await mutate(b.token,dataset.id,"update public.rows set title='Edited'")).status).toBe(200);
  expect((await mutate(b.token,dataset.id,'update public.rows set done_by=done_by')).status).toBe(403);
  const response=await replaceRoute(await observedRequest(`/api/artifacts/${dataset.id}`,{method:'PUT',token:b.token,json:{dataset:[{id:1,done_by:a.user.id,title:'Replaced'}],columns}}),ctx(dataset.id));
  expect(response.status).toBe(403);
 });
 it('rechecks membership after shares change and accepts membership in either scope',async()=>{
  const a=await account('owner'), b=await account('member');
  const one=await create(a.token,{markup:'<h1>One</h1>'});
  const two=await create(a.token,{markup:'<h1>Two</h1>',shares:[{email:b.user.email,role:'viewer'}]});
  const dataset=await create(a.token,{dataset:[{who:null}],columns:[{name:'who',type:'user',constraints:{memberOf:[`ref:${one.id}`,`ref:${two.id}`]}}],access:'readwrite'});
  expect((await mutate(a.token,dataset.id,`update public.rows set who='${b.user.id}'`)).status).toBe(200);
  await setMetadataFor({tokenId:a.tokenId,userId:a.user.id},two.id,{shares:[]});
  expect((await mutate(a.token,dataset.id,`update public.rows set who='${b.user.id}'`)).status).toBe(403);
 });
 it('executes a row button as its caller and rejects an anonymous $_me',async()=>{
  const a=await account('owner'), b=await account('editor');
  const dataset=await create(a.token,{dataset:[{id:1,who:null}],columns:[{name:'who',type:'user',constraints:{self:true}}],access:'readwrite',shares:[{email:b.user.email,role:'editor'}]});
  const markup=`<Helmet><Query name="tasks" source="ref:${dataset.id}">{\`select *, '' as action from public.rows\`}</Query><Mutation name="done" source="ref:${dataset.id}" expectedAffected={1}>{\`update public.rows set who=$_me where id=$_row.id\`}</Mutation></Helmet><DataTable data="$tasks" rowKey="id"><Column col="id"/><Column col="who"/><Column col="action"><Button run="$done">Complete</Button></Column></DataTable>`;
  const report=await create(a.token,{markup,shares:[{email:b.user.email,role:'editor'}]});
  const response=await documentMutation(request(`/a/${report.id}/mutate`,{method:'POST',token:b.token,json:{mutation:'done',values:{_me:a.user.id},row:{id:1,who:null,action:''}}}),ctx(report.id));
  expect(response.status,await response.clone().text()).toBe(200);
  expect((await loadDatasetRows((await getArtifactById(dataset.id))!))[0].who).toBe(b.user.id);
  const anonymous=await mintToken('anonymous');
  const own=await create(anonymous.token,{dataset:[{id:1,who:null}],columns:[{name:'who',type:'user',constraints:{self:true}}],access:'readwrite'});
  const denied=await mutate(anonymous.token,own.id,'update public.rows set who=$_me');
  expect(denied.status).toBe(403);
 });
 it('refuses invalid constraint syntax instead of dropping it',async()=>{
  const a=await account('owner');
  for(const constraints of [{memberOf:[]},{memberOf:'current'},{memberOf:['current','current']},{self:'yes'},{unknown:true}]) {
   const response=await createRoute(request('/api/artifacts',{method:'POST',token:a.token,json:{dataset:[{who:null}],columns:[{name:'who',type:'user',constraints}]}}));
   expect(response.status).toBe(400);
  }
 });
});
