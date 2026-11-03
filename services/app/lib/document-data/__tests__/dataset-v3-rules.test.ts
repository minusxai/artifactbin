/**
 * v3 RULES ON A REAL WRITE: a stored v3 policy (the own-rows template) enforced on the effect through
 * mutateDataset — presets from X-Hasura-User-Id, filters that hide other people's rows from update and
 * delete, anonymous denied — and the signed-out writes migrated v1 policies keep, rate-limited.
 */
import {expect,it,vi} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {ANONYMOUS_ACTOR} from '@/lib/accounts';
import {datasetPermissionsTemplate} from '@artifactbin/utils/dataset-permissions';
import {account,datasetFixture,refusal,write} from './dataset-fixture';

useAppHarness();

it('enforces a stored own-rows policy: presets the writer, scopes update and delete to their rows, refuses anonymous',async()=>{
 const f=await datasetFixture({dataset:[{name:'seed',created_by:'someone'}]}),alice=await account('alice'),bob=await account('bob');
 const template=datasetPermissionsTemplate('own-rows',{tables:[{table:{schema:'public',name:'rows'},columns:['name','created_by']}]},{ownerColumn:'created_by'});
 if(!template.ok)throw new Error(JSON.stringify(template.errors));
 await f.db.query('UPDATE artifacts SET dataset_policy=$2::jsonb WHERE id=$1',[f.id,JSON.stringify(template.policy)]);
 const generic={nativePolicy:true};
 expect(refusal(await write(await f.row(),alice.actor,"insert into public.rows (name) values ('alice')",generic))).toBeNull();
 expect(refusal(await write(await f.row(),bob.actor,"insert into public.rows (name) values ('bob')",generic))).toBeNull();
 // The owner column is not insertable: the preset is the only way it is set.
 expect(refusal(await write(await f.row(),bob.actor,"insert into public.rows values ('forged','someone')",generic))).toBe('policy_denied');
 expect(refusal(await write(await f.row(),ANONYMOUS_ACTOR,"insert into public.rows (name) values ('anon')",generic))).toBe('dataset_read_only');
 // Bob's update and delete reach only Bob's row.
 const bobUpdate=await write(await f.row(),bob.actor,"update public.rows set name=name||'!'",generic);
 expect(refusal(bobUpdate)).toBeNull();expect(bobUpdate).toMatchObject({affected:1});
 const bobDelete=await write(await f.row(),bob.actor,"delete from public.rows where name<>'nobody'",generic);
 expect(bobDelete).toMatchObject({affected:1});
 // The owner is admin-equivalent: no rule applies.
 expect(await write(await f.row(),f.owner.actor,"update public.rows set name='owned'",generic)).toMatchObject({affected:2});
 expect(await f.rows()).toEqual([{name:'owned',created_by:'someone'},{name:'owned',created_by:alice.id}]);
});

it('rate-limits rule-admitted signed-out writes to 30 a minute per dataset',async()=>{
 const f=await datasetFixture(),roles=['viewer','signed_in','anonymous'];
 const everyoneWrites={version:3,tables:[{table:{schema:'public',name:'rows'},select_permissions:roles.map(role=>({role,permission:{columns:'*',filter:{},allow_aggregations:true}})),insert_permissions:roles.map(role=>({role,permission:{columns:'*',check:{}}}))}]};
 await f.db.query('UPDATE artifacts SET dataset_policy=$2::jsonb WHERE id=$1',[f.id,JSON.stringify(everyoneWrites)]);
 // The limiter counts per wall-clock minute: hold the clock mid-minute so the 31 writes share one bucket.
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-03T12:00:30Z'));
 try{
 for(let i=0;i<30;i++)expect(refusal(await write(await f.row(),ANONYMOUS_ACTOR,'insert into public.rows values (2)',{nativePolicy:true}))).toBeNull();
 const limited=await write(await f.row(),ANONYMOUS_ACTOR,'insert into public.rows values (2)',{nativePolicy:true});
 expect(limited).toMatchObject({reason:'dataset_read_only',detail:expect.stringContaining('limit')});
 // Owner writes are never throttled.
 expect(refusal(await write(await f.row(),f.owner.actor,'insert into public.rows values (3)'))).toBeNull();
 }finally{vi.useRealTimers();}
});
