import {nativeHtml} from './native-html-fixture';
import {nativeDatasetClient} from './native-dataset-http';
import { PUBLIC_BASE_URL } from '@/lib/platform/config';
import {patchMetadata} from './conditional-request';
import {describe, expect, it} from 'vitest';
import {POST as createRoute} from '@/app/api/artifacts/route';
import {PUT as replaceRoute} from '@/app/api/artifacts/[id]/route';
import {observedRequest} from '@/__tests__/conditional-request';
import {POST as mutateRoute} from '@/app/api/artifacts/[id]/mutate/route';
import {getDb} from '@/lib/platform';
import { getArtifactById, changeMembership } from '@/lib/artifacts';
import {loadDatasetRows} from '@/lib/datasets/dataset-store';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { identityForUser, createUser } from '@/lib/accounts';
import { claimToken } from '@/lib/authentication';
import {people,userOptions} from '@/lib/datasets/user-fields';
import { avatarUrl } from '@/lib/avatars';
import {useAppHarness, request} from '@/__tests__/harness';
import {GET as rawRoute} from '@/app/a/[id]/raw/route';

useAppHarness();
const ctx = (id:string)=>({params:Promise.resolve({id})});
async function account(name:string) {
 const user=await createUser({email:`mxmx_test_${name}@example.com`,name});
 const token = await mintToken(name, user.id);
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
  const good=await mutate(a.token,dataset.id,'update public.rows set done_by=$_me.id',{'_me.id':b.user.id,_me__id:b.user.id});
  expect(good.status,await good.clone().text()).toBe(200);
  expect((await loadDatasetRows((await getArtifactById(dataset.id))!))[0].done_by).toBe(a.user.id);
  expect((await getArtifactById(dataset.id))!.meta.columns).toContainEqual({name:'done_by',type:'user',constraints:{self:true}});
 });
 it('uses union membership, rejects unknown users and enforces replacements',async()=>{
  const a=await account('owner'), b=await account('member'), c=await account('outsider');
  const report=await create(a.token,{html:nativeHtml('<h1>Project</h1>'),shares:[{email:b.user.email,role:'viewer'}]});
  const dataset=await create(a.token,{dataset:[{id:1,assignee:null}],columns:[{name:'assignee',type:'user',constraints:{memberOf:[`ref:${report.id}`]}}],access:'readwrite'});
  expect((await mutate(a.token,dataset.id,`update public.rows set assignee='${b.user.id}'`)).status).toBe(200);
  expect((await mutate(a.token,dataset.id,`update public.rows set assignee='${c.user.id}'`)).status).toBe(403);
  expect((await mutate(a.token,dataset.id,"update public.rows set assignee='usr_missing'")).status).toBe(403);
 });
 it('freezes current on first report attachment and supplies typed member choices',async()=>{
  const a=await account('owner'), b=await account('member');
  const dataset=await create(a.token,{dataset:{kind:'stored',tables:[{schema:'public',name:'rows',columns:[{name:'id',type:'number'},{name:'assignee',type:'user',constraints:{memberOf:['current']}}],rows:[{id:1,assignee:null}]}]},access:'readwrite'});
  const html=`<!doctype html><html><head><link rel="af-dataset" data-af-name="records" href="ref:${dataset.id}" data-af-mode="live"></head><body><h1>Assigned work</h1></body></html>`;
  const report=await create(a.token,{html,shares:[{email:b.user.email,role:'viewer'}]});
  expect((await getArtifactById(dataset.id))!.version).toBe(2);
  const archived=await (await getDb()).query<{meta:{columns:Array<{constraints?:{memberOf:string[]}}>}}> ('SELECT meta FROM artifact_versions WHERE artifact_id=$1 AND version=1',[dataset.id]);
  expect(archived.rows[0].meta.columns[1].constraints?.memberOf).toEqual(['current']);
  const column=(await getArtifactById(dataset.id))!.meta.columns as Array<{name:string;type:'user';constraints?:{memberOf:string[]}}>;
  expect(column[1].constraints?.memberOf).toEqual([`ref:${report.id}`]);
  const options=await userOptions(await getDb(),column[1],a.user.id);
  expect(options.map(option=>option.value).sort()).toEqual([a.user.id,b.user.id].sort());
  const replacement=await replaceRoute(await observedRequest(`/api/artifacts/${dataset.id}`,{method:'PUT',token:a.token,json:{dataset:{kind:'stored',tables:[{schema:'public',name:'rows',columns:[{name:'id',type:'number'},{name:'assignee',type:'user',constraints:{memberOf:['current']}}],rows:[{id:1,assignee:null}]}]}}}),ctx(dataset.id));
  expect(replacement.status,await replacement.clone().text()).toBe(200);
  expect((await getArtifactById(dataset.id))!.source).toContain(`ref:${report.id}`);
  expect((await getArtifactById(dataset.id))!.source).not.toContain('current');
  await create(a.token,{html});
  expect(((await getArtifactById(dataset.id))!.meta.columns as typeof column)[1].constraints?.memberOf).toEqual([`ref:${report.id}`]);
 });

 it('refuses foreign-owner current scope binding without archiving or changing the dataset',async()=>{
  const owner=await account('scope-owner'),other=await account('scope-other');
  const dataset=await create(owner.token,{dataset:[{who:null}],columns:[{name:'who',type:'user',constraints:{memberOf:['current']}}],access:'readwrite'});
  const before=await getArtifactById(dataset.id);
  const html=`<!doctype html><html><head><link rel="af-dataset" data-af-name="records" href="ref:${dataset.id}" data-af-mode="live"></head><body><h1>Foreign scope</h1></body></html>`;
  const response=await createRoute(request('/api/artifacts',{method:'POST',token:other.token,json:{html}}));
  expect(response.status,await response.clone().text()).toBe(403);
  const after=await getArtifactById(dataset.id);
  expect(after?.version).toBe(before?.version);
  expect(after?.meta).toEqual(before?.meta);
  expect((await (await getDb()).query('SELECT version FROM artifact_versions WHERE artifact_id=$1',[dataset.id])).rows).toHaveLength(0);
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
  const one=await create(a.token,{html:nativeHtml('<h1>One</h1>')});
  const two=await create(a.token,{html:nativeHtml('<h1>Two</h1>'),shares:[{email:b.user.email,role:'viewer'}]});
  const dataset=await create(a.token,{dataset:[{who:null}],columns:[{name:'who',type:'user',constraints:{memberOf:[`ref:${one.id}`,`ref:${two.id}`]}}],access:'readwrite'});
  expect((await mutate(a.token,dataset.id,`update public.rows set who='${b.user.id}'`)).status).toBe(200);
  expect((await patchMetadata(a.token,two.id,{shares:[]})).status).toBe(200);
  expect((await mutate(a.token,dataset.id,`update public.rows set who='${b.user.id}'`)).status).toBe(403);
 });
 it('executes a native row update as its caller and refuses a forged self identity',async()=>{
  const a=await account('owner'),b=await account('editor');
  const dataset=await create(a.token,{dataset:[{id:1,who:null}],columns:[{name:'who',type:'user',constraints:{self:true}}],access:'readwrite',shares:[{email:b.user.email,role:'editor'}]});
  const report=await create(a.token,{visibility:'public',html:`<!doctype html><html><head><link rel="af-dataset" data-af-name="records" href="ref:${dataset.id}" data-af-mode="live"></head><body><h1>Tasks</h1></body></html>`});
  const client=nativeDatasetClient(report.id),schema=await client.schema({token:b.token});
  expect(schema.body.errors).toBeUndefined();const table=schema.body.data!.records!.schema.tables[0]!;
  const rows=await client.rows(table.id,{token:b.token});const row=rows.body.data!.records!.rows.rows[0]!;
  const change=(who:string)=>[{kind:'UPDATE',rowId:row.id,cells:[{columnId:table.columns.find(column=>column.label==='who')!.id,value:{type:'STRING',string:who}}]}];
  const forged=await client.write(table.id,'1',change(a.user.id),'forged-self',{token:b.token});
  expect(forged.body.data?.records?.writeRows?.outcome).not.toBe('committed');
  expect((await getArtifactById(dataset.id))?.version).toBe(1);
  const valid=await client.write(table.id,'1',change(b.user.id),'own-self',{token:b.token});
  expect(valid.body.data?.records?.writeRows?.outcome,JSON.stringify(valid.body)).toBe('committed');
  expect((await loadDatasetRows((await getArtifactById(dataset.id))!))[0].who).toBe(b.user.id);
  const anonymous=await mintToken('anonymous',null);expect((await mutate(anonymous.token,dataset.id,'update public.rows set who=$_me.id')).status).toBe(401);
 });
 it('serves authored HTML without injecting the reader identity or account credentials',async()=>{
  const owner=await account('host'),reader=await account('reader');
  const report=await create(owner.token,{html:nativeHtml('<p data-af-id="reader-label">Authored label</p>'),visibility:'public'});
  const response=await rawRoute(request(`/a/${report.id}/raw`,{token:reader.token}),ctx(report.id));expect(response.status).toBe(200);
  const html=await response.text();expect(html).toContain('Authored label');
  for(const secret of [reader.token,reader.user.id,reader.user.email!])expect(html).not.toContain(secret);
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
  expect(cards[member.user.id]!.image).toBe(new URL(`/api/users/${member.user.id}/avatar?v=deadbeef`, PUBLIC_BASE_URL).href);
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
 const report=await create(a.token,{html:nativeHtml('<h1>Project</h1>'),visibility:'public'});
 const dataset=await create(a.token,{dataset:[{id:1,assignee:null}],columns:[{name:'assignee',type:'user',constraints:{memberOf:[`ref:${report.id}`]}}],access:'readwrite'});
 await changeMembership(identityForUser(b.user.id, b.tokenId),report.id,{action:'join'});
 expect((await mutate(a.token,dataset.id,`update public.rows set assignee='${b.user.id}'`)).status).toBe(403);
 await changeMembership(identityForUser(a.user.id, a.tokenId),report.id,{action:'approve',userId:b.user.id});
 expect((await mutate(a.token,dataset.id,`update public.rows set assignee='${b.user.id}'`)).status).toBe(200);
 await changeMembership(identityForUser(b.user.id, b.tokenId),report.id,{action:'leave'});
 expect((await mutate(a.token,dataset.id,`update public.rows set assignee='${b.user.id}'`)).status).toBe(403);
});
