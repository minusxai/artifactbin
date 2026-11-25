/**
 * THE SAVED REVISION'S SCHEMA DOOR (GET /api/artifacts/<page>/sql/schema?revision=N, lib/page-doors revision-schema),
 * on real handlers and storage: it describes the page's pinned stored links at their pinned revision only, never the
 * dataset's head or a link the page does not pin, never opens a row, holds its answer to SERVICE_PAYLOAD_LIMIT, and
 * answers 404 once the page, a dataset or the group no longer holds.
 */
import {expect,it,onTestFinished,vi} from 'vitest';
import {storePolicy,trashRow} from '@/__tests__/artifact-fixtures';
import {setArtifact} from '@/__tests__/rows';
import {createAppHost} from '@/server/host';
import {createGroup} from '@/lib/groups';
import {getDb} from '@/lib/platform';
import {admitGroupMember,mintAccountToken,useAppHarness} from './harness';
// The door's budget is the service payload limit; this file holds it at 200 KiB so a wide table passes it without
// building megabytes of metadata.
vi.mock('@artifactbin/contracts/payload-limit',async original=>({...await original<object>(),SERVICE_PAYLOAD_LIMIT:200*1024}));
useAppHarness();

it('describes only the pinned revision of pinned links, opens no rows, holds the budget and refuses once the page or a dataset moves',async()=>{
 const owner=await mintAccountToken('mxmx_test_schema_owner'),member=await mintAccountToken('mxmx_test_schema_member');
 const group=await createGroup(owner.userId!,{handle:'schema_door',name:'Schema door'});
 await admitGroupMember(owner.userId!,group.id,member.userId!,'member');
 const host=await createAppHost({ownsDatabase:false}),db=await getDb();
 onTestFinished(host.close);
 const as=(who:typeof owner)=>({credential:'bearer' as const,userId:who.userId!,tokenId:who.id});
 const call=(who:typeof owner,path:string,method='GET',body?:unknown)=>host.request(new Request('http://localhost'+path,{method,...(body===undefined?{}:{body:JSON.stringify(body),headers:{'content-type':'application/json'}})}),as(who));
 const create=async(body:Record<string,unknown>)=>{const r=await call(owner,'/api/artifacts','POST',{visibility:'private',destination:{type:'group',id:group.id},...body});const b=await r.json();expect(r.status,JSON.stringify(b)).toBe(201);return b as {id:string};};
 const dataset=await create({title:'Metrics',dataset:[{label:'visible',team:'red',amount:10,secret:'hidden'}]});
 await storePolicy(dataset.id,{version:3,tables:[{table:{schema:'public',name:'rows'},select_permissions:[{role:'viewer',permission:{columns:['label','team','amount'],filter:{}}}]}]});
 const live=await create({title:'Live',dataset:[{live_note:'live-value'}]});
 const page=await create({title:'Saved metrics',html:`<!doctype html><html><head><link rel="af-dataset" data-af-name="metrics" href="ref:${dataset.id}" data-af-mode="pinned" data-af-revision="1"><link rel="af-dataset" data-af-name="live" href="ref:${live.id}"></head><body><h1>Saved metrics</h1></body></html>`});
 const schema=async(id=page.id,revision='1')=>{const r=await call(member,`/api/artifacts/${id}/sql/schema?revision=${revision}`);return {status:r.status,text:await r.text()};};

 const first=await schema();expect(first.status,first.text).toBe(200);
 const body=JSON.parse(first.text);
 expect(body.bindings).toEqual([{name:'metrics',datasetId:dataset.id,revision:'1'}]);
 expect(body.tables[0].columns.map((c:{name:string})=>c.name)).toEqual(expect.arrayContaining(['label','team','amount']));
 expect(first.text).not.toContain('secret');expect(first.text).not.toContain('live_note');

 // The dataset's head moves on with a new column: the pinned revision's shape is what the door describes.
 const observed=await(await call(owner,'/api/artifacts/'+dataset.id)).json();
 const changed=await call(owner,'/api/artifacts/'+dataset.id,'PUT',{dataset:[{label:'head',team:'red',amount:700,head_only:'x',secret:'head-secret'}],expectedVersion:observed.version,expectedState:observed.state});
 expect(changed.status,await changed.clone().text()).toBe(200);
 const pinned=await schema();expect(pinned.status,pinned.text).toBe(200);expect(pinned.text).not.toContain('head_only');

 // Schema discovery never opens row objects.
 const datasets=await import('@/lib/datasets'),loadRows=vi.spyOn(datasets,'loadDatasetRows').mockRejectedValue(Error('schema opened rows'));
 expect((await schema()).status).toBe(200);expect(loadRows).not.toHaveBeenCalled();loadRows.mockRestore();

 // Metadata past the budget is 413 too_large, naming no column.
 const wide=await create({title:'Wide metadata',dataset:[Object.fromEntries(Array.from({length:2800},(_,i)=>['column_'+i+'_'+'x'.repeat(64),i]))]});
 const widePage=await create({title:'Wide page',html:`<html><head><link rel="af-dataset" data-af-name="wide" href="ref:${wide.id}" data-af-mode="pinned" data-af-revision="1"></head><body>Metadata</body></html>`});
 const tooLarge=await schema(widePage.id);expect(tooLarge.status,tooLarge.text.slice(0,200)).toBe(413);
 expect(JSON.parse(tooLarge.text)).toEqual({error:'too_large',max:200*1024});

 // Each fence: the dataset leaves the group or is trashed, its pinned archive is gone, the page moves, the group is deleted.
 const original=(await db.query('SELECT group_id FROM artifacts WHERE id=$1',[dataset.id])).rows[0];
 const foreign=await createGroup(owner.userId!,{handle:'schema_foreign',name:'Foreign'});
 for(const mutate of [()=>setArtifact(db,dataset.id,{group_id:foreign.id}),()=>trashRow(dataset.id)]){
  await mutate();const refused=await schema();expect(refused.status).toBe(404);expect(refused.text).not.toContain('label');
  await setArtifact(db,dataset.id,{group_id:original.group_id,deleted_at:null});
 }
 expect((await schema()).status).toBe(200);
 const archived=(await db.query('SELECT * FROM artifact_versions WHERE artifact_id=$1 AND version=1',[dataset.id])).rows[0];expect(archived).toBeTruthy();
 await db.query('DELETE FROM artifact_versions WHERE artifact_id=$1 AND version=1',[dataset.id]);
 // An unavailable exact revision never becomes a head read.
 const unarchived=await schema();expect(unarchived.status).toBe(404);expect(unarchived.text).not.toContain('head');
 const keys=Object.keys(archived);await db.query('INSERT INTO artifact_versions ('+keys.join(',')+') VALUES ('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',keys.map(k=>archived[k]));
 expect((await schema()).status).toBe(200);
 await setArtifact(db,page.id,{version:{sql:'version+1'}});expect((await schema()).status).toBe(404);
 await setArtifact(db,page.id,{version:{sql:'version-1'}});expect((await schema()).status).toBe(200);
 await db.query('UPDATE groups SET deleted_at=now() WHERE id=$1',[group.id]);expect((await schema()).status).toBe(404);
});
