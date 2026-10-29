/**
 * THE DATASET WRITE through its public door (mutateDataset): a committed write, the edit_id
 * compare-and-swap and the expected-state guard. Every conflict is produced by handing the door a
 * stale row, never by intercepting its statements. Access and policy: dataset-mutate-access;
 * grants, user fields and notification jobs: dataset-mutate-commit.
 */
import {afterEach,beforeEach,expect,it} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {artifactState} from '@/lib/artifacts';
import { onDatasetCommitted } from '@/lib/artifacts/testing';
import {datasetFixture as fixture,refusal,write} from './dataset-fixture';

useAppHarness();
let committed:string[]=[],stop=()=>{};
beforeEach(()=>{committed=[];stop=onDatasetCommitted(id=>{committed.push(id);});});
afterEach(()=>stop());

it('applies an owner write to a readwrite dataset, advances its version and announces the commit',async()=>{
 const f=await fixture(),before=await f.row();
 const result=await write(before,f.owner.actor,'insert into public.rows values (2)');
 expect(refusal(result)).toBeNull();
 expect(result).toMatchObject({affected:1,rowCount:2,row:{id:f.id,version:before.version+1}});
 expect(await f.rows()).toEqual([{n:1},{n:2}]);
 expect((await f.row()).edit_id).not.toBe(before.edit_id);
 expect(committed).toEqual([f.id]);
});

it('rebases a write read at a stale edit_id onto the rows that landed, losing neither',async()=>{
 const f=await fixture(),stale=await f.row();
 expect(refusal(await write(stale,f.owner.actor,'update public.rows set n=n+10'))).toBeNull();
 const result=await write(stale,f.owner.actor,'update public.rows set n=n*2');
 expect(refusal(result)).toBeNull();
 expect(await f.rows()).toEqual([{n:22}]);
 expect((await f.row()).version).toBe(stale.version+2);
});

it('refuses a write whose expected state has moved, and applies one whose state still matches',async()=>{
 const f=await fixture(),state=artifactState(await f.row());
 expect(refusal(await write(await f.row(),f.owner.actor,'update public.rows set n=5',{expectedState:state}))).toBeNull();
 expect(refusal(await write(await f.row(),f.owner.actor,'update public.rows set n=6',{expectedState:state}))).toBe('row_changed');
 expect(await f.rows()).toEqual([{n:5}]);
 expect(committed).toEqual([f.id]);
});
