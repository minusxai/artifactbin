import {documentPublicationWithResources} from './prepared-document';
import {patchMetadata} from './conditional-request';
import {changeMembership} from '@/lib/membership';
import {POST as documentMutation} from '@/app/a/[id]/mutate/route';
import {describe, expect, it} from 'vitest';
import {POST as createRoute} from '@/app/api/artifacts/route';
import {PUT as replaceRoute} from '@/app/api/artifacts/[id]/route';
import {observedRequest} from '@/__tests__/conditional-request';
import {POST as mutateRoute} from '@/app/api/artifacts/[id]/mutate/route';
import {getDb} from '@/lib/db';
import {getArtifactById,dataflowForRow,applyEditFor,commitNormalizedMarkup,publishMarkupForArtifact,viewerIdentityFor} from '@/lib/artifacts';
import {loadDatasetRows} from '@/lib/story/dataset-store';
import {mintToken} from '@/lib/tokens';
import {claimToken, createUser} from '@/lib/users';
import {people} from '@/lib/datasets/user-fields';
import {avatarUrl} from '@/lib/avatars';
import {useAppHarness, request} from '@/__tests__/harness';
import {GET as rawRoute} from '@/app/a/[id]/raw/route';
import {personFaceBackground, personInitial} from '@/lib/person-face';

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
  const replacement=await replaceRoute(await observedRequest(`/api/artifacts/${dataset.id}`,{method:'PUT',token:a.token,json:{dataset:{kind:'stored',tables:[{schema:'public',name:'rows',columns:[{name:'id',type:'number'},{name:'assignee',type:'user',constraints:{memberOf:['current']}}],rows:[{id:1,assignee:null}]}]}}}),ctx(dataset.id));
  expect(replacement.status,await replacement.clone().text()).toBe(200);
  expect((await getArtifactById(dataset.id))!.source).toContain(`ref:${report.id}`);
  expect((await getArtifactById(dataset.id))!.source).not.toContain('current');
  await create(a.token,{markup});
  expect(((await getArtifactById(dataset.id))!.meta.columns as typeof column)[1].constraints?.memberOf).toEqual([`ref:${report.id}`]);
 });
 it.each(['normalized','atomic'])('binds current when %s markup edits first attach a dataset',async(kind)=>{
  const a=await account('owner');
  const dataset=await create(a.token,{dataset:[{id:1,assignee:null}],columns:[{name:'assignee',type:'user',constraints:{memberOf:['current']}}]});
  const report=await create(a.token,{markup:'<h1>Project</h1>'});
  const current=(await getArtifactById(report.id))!;
  const prepared=await publishMarkupForArtifact(current,`<Helmet><Query name="tasks" source="ref:${dataset.id}">{\`select * from public.rows\`}</Query></Helmet><DataTable data="$tasks" />`);
  if(prepared instanceof Response)throw new Error(await prepared.text());
  if(kind==='normalized')await (await getDb()).transaction(tx=>commitNormalizedMarkup(tx,null,current,prepared));
  else {
   const result=await applyEditFor({tokenId:a.tokenId,userId:a.user.id},report.id,{baseEditId:current.edit_id,documentUpdate:(await documentPublicationWithResources(current,{source:prepared.source})).document_update});
   expect(result).toMatchObject({applied:true});
  }
  expect((await getArtifactById(dataset.id))!.meta.columns).toContainEqual({name:'assignee',type:'user',constraints:{memberOf:[`ref:${report.id}`]}});
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
  expect((await patchMetadata(a.token,two.id,{shares:[]})).status).toBe(200);
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
 /*
  * WHO IS READING, NAMED. A <User> may show the viewer themselves, and the
  * label comes from the SAME lookup a DataTable cell has always used: one row,
  * by id, for the person already logged in and asking. Never an email, never a
  * directory — a guest is told nothing at all.
  */
 it('names the viewer to themselves and nobody to a guest',async()=>{
  const reader=await account('reader'), owner=await account('host');
  const markup='<Helmet><Value name="rows" type="table" value={[{"n":1}]} /></Helmet><p>Paid by <User userId="$_me" /></p>';
  const report=await create(owner.token,{markup,visibility:'public'});
  const row=(await getArtifactById(report.id))!;
  const mine=await dataflowForRow(row,{viewer:{userId:reader.user.id,tokenId:null,email:reader.user.email}});
  expect(mine?.state.people).toEqual({[reader.user.id]:{name:'reader',handle:null,image:null}});
  expect(JSON.stringify(mine?.state.people)).not.toContain('@');
  expect((await dataflowForRow(row,{}))?.state.people ?? {}).toEqual({});
  // The island carries the same answer, so first paint needs no query at all —
  // and a document that names nobody pays for no lookup.
  expect(await viewerIdentityFor({source:markup},reader.user.id)).toEqual({id:reader.user.id,card:{name:'reader',handle:null,image:null}});
  expect(await viewerIdentityFor({source:'<p>nobody here</p>'},reader.user.id)).toEqual({id:reader.user.id});
  expect(await viewerIdentityFor({source:markup},null)).toBeNull();
  // A face and a handle are the same person as a <User>, so they buy the card too.
  for(const tag of ['<UserImage userId="$_me" />','<UserHandle userId="$_me" />'])
   expect(await viewerIdentityFor({source:`<p>${tag}</p>`},reader.user.id)).toEqual({id:reader.user.id,card:{name:'reader',handle:null,image:null}});
 });
 /*
  * THE SAME PERSON, NAMED TWICE. A person tag's `id` is the person, not the
  * element: publish must not treat a second `id="$_me"` as a duplicate NODE id
  * and re-mint it, which left the second tag naming nobody ("Unknown person").
  * Through the real publish and the real served page, for every person tag.
  */
 it('resolves every person tag naming the viewer, however many, in the served page',async()=>{
  const reader=await account('twice'), owner=await account('host');
  const cases=[
   '<p><User userId="$_me" /> <UserImage userId="$_me" size="lg" /></p>',
   '<p><UserImage userId="$_me" /> <UserImage userId="$_me" size="lg" /></p>',
   '<p><UserHandle userId="$_me" /> <UserImage userId="$_me" size="lg" /></p>',
   '<Helmet><Value name="rows" type="table" value={[{"n":1},{"n":2}]} /></Helmet><p><User userId="$_me" /></p><For each={$rows}><span><UserImage userId="$_me" /></span></For>',
  ];
  for(const markup of cases){
   const report=await create(owner.token,{markup,visibility:'public'});
   const stored=(await getArtifactById(report.id))!.source ?? '';
   expect(stored.match(/userId="\$_me"/g),stored).toHaveLength(2);
   const html=await (await rawRoute(request(`/a/${report.id}/raw`,{token:reader.token}),ctx(report.id))).text();
   const body=html.slice(html.indexOf('class="mx-doc"'));
   expect(body,markup).not.toContain('data-unknown');
   expect(body,markup).not.toContain('Unknown person');
   expect(body.match(/aria-label="twice"/g)?.length ?? 0,markup).toBeGreaterThanOrEqual(1);
   expect(body,markup).toContain(`background-color:${personFaceBackground(reader.user.id)}`);
   expect(body,markup).toContain(`>${personInitial('twice')}</span>`);
  }
 });
 /*
  * THE CARD, WHOLE. A person is a name, a handle and a picture, and the picture
  * is an ADDRESS computed in exactly one place (lib/avatars avatarUrl) — the
  * stored key never leaves the server, and a person without one is a null the
  * client draws an initial for rather than a broken image.
  */
 it('carries the handle and the picture address of the people a document already saw',async()=>{
  const owner=await account('host'), member=await account('pictured');
  const db=await getDb();
  await db.query('UPDATE users SET username=$2, image_key=$3 WHERE id=$1',[member.user.id,'pictured','avatar/deadbeef']);
  const cards=await people(db,[member.user.id,owner.user.id,'usr_missing']);
  expect(cards[member.user.id]).toEqual({name:'pictured',handle:'pictured',image:avatarUrl({id:member.user.id,image_key:'avatar/deadbeef'})});
  expect(cards[member.user.id]!.image).toBe(`/api/users/${member.user.id}/avatar?v=deadbeef`);
  expect(cards[owner.user.id]).toEqual({name:'host',handle:null,image:null});
  // Never invented: an id nobody has is simply absent, and the client says so.
  expect(cards['usr_missing']).toBeUndefined();
  expect(JSON.stringify(cards)).not.toContain('@');
  expect(await people(db,[])).toEqual({});
 });
 it('refuses invalid constraint syntax instead of dropping it',async()=>{
  const a=await account('owner');
  for(const constraints of [{memberOf:[]},{memberOf:'current'},{memberOf:['current','current']},{self:'yes'},{unknown:true}]) {
   const response=await createRoute(request('/api/artifacts',{method:'POST',token:a.token,json:{dataset:[{who:null}],columns:[{name:'who',type:'user',constraints}]}}));
   expect(response.status).toBe(400);
  }
 });
});

it('offers accepted joiners in constrained user fields and permits assigning them',async()=>{
 const a=await account('joined_owner'), b=await account('joined_reader');
 const report=await create(a.token,{markup:'<h1>Project</h1>',visibility:'public'});
 const dataset=await create(a.token,{dataset:[{id:1,assignee:null}],columns:[{name:'assignee',type:'user',constraints:{memberOf:[`ref:${report.id}`]}}],access:'readwrite'});
 await changeMembership({userId:b.user.id,tokenId:b.tokenId},report.id,{action:'join'});
 expect((await mutate(a.token,dataset.id,`update public.rows set assignee='${b.user.id}'`)).status).toBe(403);
 await changeMembership({userId:a.user.id,tokenId:a.tokenId},report.id,{action:'approve',userId:b.user.id});
 expect((await mutate(a.token,dataset.id,`update public.rows set assignee='${b.user.id}'`)).status).toBe(200);
 await changeMembership({userId:b.user.id,tokenId:b.tokenId},report.id,{action:'leave'});
 expect((await mutate(a.token,dataset.id,`update public.rows set assignee='${b.user.id}'`)).status).toBe(403);
});
