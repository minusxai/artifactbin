import {z} from 'zod';
import type {MutationNotificationJobStore} from '@artifactbin/contracts';
import type {Operation} from './registry';
import {mutationInitiator} from '../mutation-operation';

/** Transport adapters depend only on the authorized job repository, never queue SQL. */
export function notificationJobOperations(store:()=>Promise<MutationNotificationJobStore>):Operation[]{
 const errors=[{status:404,code:'not_found',fix:'Use a run or job you initiated, or manage its document.'}];
 return [
  {name:'list_notification_jobs',title:'Read a mutation run’s notification jobs',http:{method:'GET',path:'/api/notification-runs/{runId}/jobs'},description:'Read notification processing status after a successful named mutation. Use mutationRunId from the saved mutation reply. Only its initiating principal or current document managers may inspect the run.',input:{runId:z.string().min(1).max(128)},annotations:{readOnly:true},example:{input:{runId:'opaque-mutation-run'}},errors,async run(ctx,input){return {status:200,body:{jobs:await (await store()).list(mutationInitiator(ctx.actor,'agent').principal,String(input.runId))}};}},
  {name:'get_notification_job',title:'Read notification job status',http:{method:'GET',path:'/api/notification-jobs/{jobId}'},description:'Read a notification job’s status, attempts and safe error code. This does not execute its query or repeat the mutation.',input:{jobId:z.string().min(1).max(128)},annotations:{readOnly:true},example:{input:{jobId:'opaque-notification-job'}},errors,async run(ctx,input){const job=await (await store()).status(mutationInitiator(ctx.actor,'agent').principal,String(input.jobId));return job?{status:200,body:{job}}:{status:404,body:{error:'not_found'}};}},
  {name:'retry_notification_job',title:'Retry a failed notification query',http:{method:'POST',path:'/api/notification-jobs/{jobId}/retry'},description:'Retry a failed notification job with its original rule, arguments and identity. It may read newer data. Never rerun the successful mutation to recover a notification failure.',input:{jobId:z.string().min(1).max(128)},annotations:{idempotent:true},example:{input:{jobId:'opaque-notification-job'}},errors,async run(ctx,input){return await (await store()).retry(mutationInitiator(ctx.actor,'agent').principal,String(input.jobId))?{status:200,body:{ok:true}}:{status:404,body:{error:'not_found'}};}},
 ];
}
