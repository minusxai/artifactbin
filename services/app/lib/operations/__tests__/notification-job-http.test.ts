/**
 * The notification job transport (notificationJobHttp over the registry's job operations and the
 * application's authority-bound store): who is turned away before the store is asked, and that a
 * real failed job reads and retries for its initiator and nobody else.
 */
import {expect,it} from 'vitest';
import type {MutationNotificationJobInput} from '@artifactbin/contracts';
import {useAppHarness,request,mintAccountToken,setSession} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {notificationJobStore} from '@/lib/document-data';
import {notificationJobHttp} from '../notification-job-http';

useAppHarness();
async function failedJob(){
 const owner=await mintAccountToken('jobs-owner'),other=await mintAccountToken('jobs-other'),db=await getDb(),store=await notificationJobStore();
 const input:MutationNotificationJobInput={origin:{mutationRunId:'run',documentId:'doc',documentEditId:'edit',documentVersion:1,mutationName:'change'},initiator:{principal:{kind:'token',id:owner.id},execution:'agent',agentLabel:null},
  rules:[{name:'notice',on:'change',sql:'select 1'}],bindings:{values:{},types:{},userId:owner.userId,now:'2026-01-01T00:00:00Z',tz:'UTC'},contextRevision:'context',contextSnapshot:{version:1}};
 await db.transaction(tx=>store.enqueue(tx,input));
 const claim=(await store.claim())!;await store.fail(claim,'notification_query_invalid',false);
 return {owner,other,jobId:claim.jobId};
}
const call=async(name:string,path:string,input:Record<string,unknown>,options:Parameters<typeof request>[1]={})=>{
 const response=await notificationJobHttp(name,request(path,options),input);return [response.status,await response.json()] as const;
};

it('refuses a caller with no credential before reading any job',async()=>{
 expect(await call('list_notification_jobs','/api/notification-runs/run/jobs',{runId:'run'})).toEqual([401,{error:'unauthorized'}]);
});

it('refuses a cross-site cookie write but not a cross-site read or a bearer write',async()=>{
 const f=await failedJob();
 setSession({user:{id:f.owner.userId!,email:f.owner.email!}});
 expect(await call('retry_notification_job',`/api/notification-jobs/${f.jobId}/retry`,{jobId:f.jobId},{method:'POST',origin:'https://elsewhere.example'})).toEqual([403,{error:'forbidden'}]);
 const [read,body]=await call('get_notification_job',`/api/notification-jobs/${f.jobId}`,{jobId:f.jobId},{origin:'https://elsewhere.example'});
 expect([read,body.job.status]).toEqual([200,'failed']);
 setSession(null);
 expect(await call('retry_notification_job',`/api/notification-jobs/${f.jobId}/retry`,{jobId:f.jobId},{method:'POST',token:f.owner.token,origin:'https://elsewhere.example'})).toEqual([200,{ok:true}]);
});

it('reads and retries a failed job for its initiating token and its account, and hides it from anyone else',async()=>{
 const f=await failedJob();
 expect(await call('get_notification_job',`/api/notification-jobs/${f.jobId}`,{jobId:f.jobId},{token:f.other.token})).toEqual([404,{error:'not_found'}]);
 expect(await call('list_notification_jobs','/api/notification-runs/run/jobs',{runId:'run'},{token:f.other.token})).toEqual([200,{jobs:[]}]);
 expect(await call('retry_notification_job',`/api/notification-jobs/${f.jobId}/retry`,{jobId:f.jobId},{method:'POST',token:f.other.token})).toEqual([404,{error:'not_found'}]);
 const [listed,list]=await call('list_notification_jobs','/api/notification-runs/run/jobs',{runId:'run'},{token:f.owner.token});
 expect([listed,list.jobs]).toEqual([200,[expect.objectContaining({id:f.jobId,status:'failed',error_code:'notification_query_invalid',notification_names:['notice']})]]);
 expect(await call('retry_notification_job',`/api/notification-jobs/${f.jobId}/retry`,{jobId:f.jobId},{method:'POST',token:f.owner.token})).toEqual([200,{ok:true}]);
 const [, after]=await call('get_notification_job',`/api/notification-jobs/${f.jobId}`,{jobId:f.jobId},{token:f.owner.token});
 expect(after.job).toMatchObject({status:'pending',attempts:0,error_code:null});
});
