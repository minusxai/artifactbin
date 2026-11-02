/**
 * What a dataset write re-checks as it commits: a cross-document grant (membership and the granted
 * document), assigned user fields, and the notification job that commits with the write and only
 * with it (scheduled inside the write, announced after it).
 */
import {expect,it} from 'vitest';
import {setDatasetPolicy,useAppHarness} from '@/__tests__/harness';
import { seedOwnerJoin } from '@/lib/social';
import {account,datasetFixture as fixture,document,refusal,write} from './dataset-fixture';

useAppHarness();

it('honours a cross-document grant only for members acting through a trusted program of a dataset admin',async()=>{
 const f=await fixture(),member=await account('member'),granted=await document(f.db,'docGranted',f.owner),other=await document(f.db,'docOther',f.owner);
 const policy={version:2,allow:[{actions:['read'],from:{user:'*'}},{actions:['insert'],from:{artifact:granted.id}}]};
 // A stored v2 policy (seeded: no door sets v1/v2 since the stored migration).
 expect(await setDatasetPolicy(f.owner.actor,f.id,policy,0)).toMatchObject({revision:1});
 const target={schema:'public',table:'rows'},sql='insert into public.rows values (7)';
 expect(refusal(await write(await f.row(),member.actor,sql,{document:granted,target}))).toBe('dataset_read_only');
 await seedOwnerJoin(f.db,granted.id,member.id);await seedOwnerJoin(f.db,other.id,member.id);
 // Plan §312 (toV3 write_page_scoped): artifact:X becomes backend_only entries, so any trusted program on a page the dataset owner owns writes, not X alone.
 expect(refusal(await write(await f.row(),member.actor,sql,{document:other,target}))).toBeNull();
 expect(refusal(await write(await f.row(),member.actor,sql))).toBe('dataset_read_only');
 expect(refusal(await write(await f.row(),member.actor,sql,{document:granted,target}))).toBeNull();
 expect(refusal(await write(await f.row(),member.actor,'delete from public.rows',{document:granted,target}))).toBe('policy_denied');
 expect(await f.rows()).toEqual([{n:1},{n:7},{n:7}]);
});

it('validates assigned user fields at commit: a self field takes only the caller, any user field only a real user',async()=>{
 const f=await fixture({dataset:[{n:1,done_by:null,owner_id:null}],columns:[{name:'done_by',type:'user',constraints:{self:true}},{name:'owner_id',type:'user'}]}),other=await account('other');
 expect(refusal(await write(await f.row(),f.owner.actor,`update public.rows set done_by='${other.id}'`))).toBe('policy_denied');
 expect(refusal(await write(await f.row(),f.owner.actor,"update public.rows set owner_id='usr_nobody'"))).toBe('policy_denied');
 expect(refusal(await write(await f.row(),f.owner.actor,`update public.rows set done_by='${f.owner.id}', owner_id='${other.id}'`))).toBeNull();
 expect(await f.rows()).toEqual([{n:1,done_by:f.owner.id,owner_id:other.id}]);
});
