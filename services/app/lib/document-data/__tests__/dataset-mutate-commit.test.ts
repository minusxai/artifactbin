/**
 * What a dataset write re-checks as it commits: assigned user fields.
 */
import {expect,it} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {account,datasetFixture as fixture,refusal,write} from './dataset-fixture';

useAppHarness();

it('validates assigned user fields at commit: a self field takes only the caller, any user field only a real user',async()=>{
 const f=await fixture({dataset:[{n:1,done_by:null,owner_id:null}],columns:[{name:'done_by',type:'user',constraints:{self:true}},{name:'owner_id',type:'user'}]}),other=await account('other');
 expect(refusal(await write(await f.row(),f.owner.actor,`update public.rows set done_by='${other.id}'`))).toBe('policy_denied');
 expect(refusal(await write(await f.row(),f.owner.actor,"update public.rows set owner_id='usr_nobody'"))).toBe('policy_denied');
 expect(refusal(await write(await f.row(),f.owner.actor,`update public.rows set done_by='${f.owner.id}', owner_id='${other.id}'`))).toBeNull();
 expect(await f.rows()).toEqual([{n:1,done_by:f.owner.id,owner_id:other.id}]);
});
