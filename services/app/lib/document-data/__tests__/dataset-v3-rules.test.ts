/**
 * v3 RULES ON A REAL WRITE: a stored v3 policy (the own-rows template) enforced on the effect through
 * the page SQL door — presets from X-Hasura-User-Id, filters that hide other people's rows from update and
 * delete, anonymous denied — and the signed-out writes migrated v1 policies keep, rate-limited.
 */
import {expect,it,vi} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {sql} from '@/__tests__/page-sql-door-fixture';
import {datasetPermissionsTemplate} from '@artifactbin/utils/dataset-permissions';
import {account,datasetFixture,datasetPage} from './dataset-fixture';
import { setArtifact } from '@/__tests__/rows';

useAppHarness();

it('enforces a stored own-rows policy: presets the writer, scopes update and delete to their rows, refuses anonymous',async()=>{
 const f=await datasetFixture({dataset:[{name:'seed',created_by:'someone'}]}),alice=await account('alice'),bob=await account('bob');
 const template=datasetPermissionsTemplate('own-rows',{tables:[{table:{schema:'public',name:'rows'},columns:['name','created_by']}]},{ownerColumn:'created_by'});
 if(!template.ok)throw new Error(JSON.stringify(template.errors));
 await setArtifact(f.db, f.id, { dataset_policy: JSON.stringify(template.policy) });
 const page=await datasetPage(f.owner,f.id);
 for (const who of [alice,bob]) {
  const added=await sql(page,who,'insert into data_rows (name) values ($name)',{name:who.email});
  expect(added.status,JSON.stringify(added.body)).toBe(200);
  expect(added.body.affected).toBe(1);
 }
 // The owner column is not insertable: the preset is the only way it is set.
 const forged=await sql(page,bob,"insert into data_rows (name,created_by) values ('forged','someone')");
 expect(forged.body.error).toBe('permission_denied');
 const anonymous=await sql(page,null,"insert into data_rows (name) values ('anon')");
 expect(anonymous.body.error).toBe('permission_denied');
 // Bob's update and delete reach only Bob's row.
 const updated=await sql(page,bob,"update data_rows set name=name||'!'");
 expect(updated.body).toMatchObject({affected:1});
 const removed=await sql(page,bob,"delete from data_rows where name<>'nobody'");
 expect(removed.body).toMatchObject({affected:1});
 // The owner is admin-equivalent: no rule applies.
 expect((await sql(page,f.owner,"update data_rows set name='owned'")).body).toMatchObject({affected:2});
 expect(await f.rows()).toEqual([{name:'owned',created_by:'someone'},{name:'owned',created_by:alice.id}]);
});

it('rate-limits rule-admitted signed-out writes to 30 a minute per dataset',async()=>{
 const f=await datasetFixture(),roles=['viewer','signed_in','anonymous'];
 const everyoneWrites={version:3,tables:[{table:{schema:'public',name:'rows'},select_permissions:roles.map(role=>({role,permission:{columns:'*',filter:{},allow_aggregations:true}})),insert_permissions:roles.map(role=>({role,permission:{columns:'*',check:{}}}))}]};
 await setArtifact(f.db, f.id, { dataset_policy: JSON.stringify(everyoneWrites) });
 const page=await datasetPage(f.owner,f.id);
 const insert=(who:Pick<typeof f.owner,'token'>|null,n:number)=>sql(page,who,'insert into data_rows (n) values ($n)',{n});
 // The limiter counts per wall-clock minute: hold the clock mid-minute so the 31 writes share one bucket.
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-03T12:00:30Z'));
 try{
 for(let i=0;i<30;i++){
  const accepted=await insert(null,2);
  expect(accepted.status,JSON.stringify(accepted.body)).toBe(200);
  expect(accepted.body.affected).toBe(1);
 }
 const limited=await insert(null,2);
 expect(limited.status).toBe(403);
 expect(JSON.stringify(limited.body)).toContain('limit');
 // Owner writes are never throttled.
 expect((await insert(f.owner,3)).body.affected).toBe(1);
 expect(await f.rows()).toHaveLength(32);
 }finally{vi.useRealTimers();}
});
