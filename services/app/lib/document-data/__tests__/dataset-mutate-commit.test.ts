/**
 * What a dataset write re-checks as it commits: a cross-document grant (membership and the granted
 * document), assigned user fields, and the notification job that commits with the write and only
 * with it (scheduled inside the write, announced after it).
 */
import {expect,it} from 'vitest';
import type {MutationNotificationJobInput} from '@artifactbin/contracts';
import {useAppHarness} from '@/__tests__/harness';
import {seedOwnerJoin} from '@/lib/accounts';
import {onDatasetCommitted} from '@/lib/artifacts/after-commit';
import {mutationInitiator,writeDatasetPolicy} from '@/lib/document-data';
import {account,datasetFixture as fixture,document,refusal,write} from './dataset-fixture';

useAppHarness();

it('honours a cross-document grant only for members acting through the granted document',async()=>{
 const f=await fixture(),member=await account('member'),granted=await document(f.db,'docGranted',f.owner),other=await document(f.db,'docOther',f.owner);
 const policy={version:2,allow:[{actions:['read'],from:{user:'*'}},{actions:['insert'],from:{artifact:granted.id}}]};
 const saved=await writeDatasetPolicy(f.owner.actor,f.id,{policy,expectedPolicyRevision:0});expect(saved.status,await saved.clone().text()).toBe(200);
 const target={schema:'public',table:'rows'},sql='insert into public.rows values (7)';
 expect(refusal(await write(await f.row(),member.actor,sql,{document:granted,target}))).toBe('dataset_read_only');
 await seedOwnerJoin(f.db,granted.id,member.id);await seedOwnerJoin(f.db,other.id,member.id);
 expect(refusal(await write(await f.row(),member.actor,sql,{document:other,target}))).toBe('dataset_read_only');
 expect(refusal(await write(await f.row(),member.actor,sql))).toBe('dataset_read_only');
 expect(refusal(await write(await f.row(),member.actor,sql,{document:granted,target}))).toBeNull();
 expect(refusal(await write(await f.row(),member.actor,'delete from public.rows',{document:granted,target}))).toBe('policy_denied');
 expect(await f.rows()).toEqual([{n:1},{n:7}]);
});

it('validates assigned user fields at commit: a self field takes only the caller, any user field only a real user',async()=>{
 const f=await fixture({dataset:[{n:1,done_by:null,owner_id:null}],columns:[{name:'done_by',type:'user',constraints:{self:true}},{name:'owner_id',type:'user'}]}),other=await account('other');
 expect(refusal(await write(await f.row(),f.owner.actor,`update public.rows set done_by='${other.id}'`))).toBe('policy_denied');
 expect(refusal(await write(await f.row(),f.owner.actor,"update public.rows set owner_id='usr_nobody'"))).toBe('policy_denied');
 expect(refusal(await write(await f.row(),f.owner.actor,`update public.rows set done_by='${f.owner.id}', owner_id='${other.id}'`))).toBeNull();
 expect(await f.rows()).toEqual([{n:1,done_by:f.owner.id,owner_id:other.id}]);
});

it('commits the notification job with the write and only with it',async()=>{
 const f=await fixture(),doc=await document(f.db,'doc_notify',f.owner,'html');
 const job=(run:string):MutationNotificationJobInput=>({origin:{mutationRunId:run,documentId:doc.id,documentEditId:doc.editId,documentVersion:1,mutationName:'change'},initiator:mutationInitiator(f.owner.actor,'agent'),
  rules:[{name:'notice',on:'change',sql:'select 1'}],bindings:{values:{},types:{},userId:f.owner.id,now:'2026-01-01T00:00:00Z',tz:'UTC'},contextRevision:'context',contextSnapshot:{version:1}});
 const jobs=async()=>(await f.db.query<{mutation_run_id:string}>('SELECT mutation_run_id FROM notification_jobs ORDER BY mutation_run_id')).rows.map(r=>r.mutation_run_id);
 // The commit announcement runs after the transaction: the job it can see is already durable.
 let seen:string[]|null=null;const stop=onDatasetCommitted(()=>{void jobs().then(ids=>{seen=ids;});});
 const result=await write(await f.row(),f.owner.actor,'update public.rows set n=2',{notificationJob:job('run_ok')}).finally(stop);
 expect(result).toMatchObject({mutationRunId:'run_ok'});
 expect(await jobs()).toEqual(['run_ok']);
 await expect.poll(()=>seen).toEqual(['run_ok']);
 // A refused write schedules nothing.
 expect(refusal(await write(await f.row(),f.owner.actor,'update public.rows set n=3',{notificationJob:job('run_stale'),expectedState:'stale'}))).toBe('row_changed');
 // A credential revoked before commit refuses the write and its job together.
 await f.db.query('UPDATE tokens SET deleted_at=now() WHERE id=$1',[f.owner.tokenId]);
 expect(refusal(await write(await f.row(),f.owner.actor,'update public.rows set n=4',{notificationJob:job('run_revoked')}))).toBe('policy_denied');
 expect(await jobs()).toEqual(['run_ok']);
 expect(await f.rows()).toEqual([{n:2}]);
});
