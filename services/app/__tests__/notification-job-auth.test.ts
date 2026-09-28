import {expect,it} from 'vitest';
import {request,useAppHarness,agentCookie} from './harness';
import {mintToken} from '@/lib/tokens';
import {GET as list} from '@/app/api/notification-runs/[runId]/jobs/route';
import {GET as status} from '@/app/api/notification-jobs/[jobId]/route';
import {POST as retry} from '@/app/api/notification-jobs/[jobId]/retry/route';
useAppHarness();
it('refuses anonymous status reads and retries before reaching a repository',async()=>{
 expect((await list(request('/api/notification-runs/run/jobs'),{params:Promise.resolve({runId:'run'})})).status).toBe(401);
 expect((await status(request('/api/notification-jobs/job'),{params:Promise.resolve({jobId:'job'})})).status).toBe(401);
 expect((await retry(request('/api/notification-jobs/job/retry',{method:'POST'}),{params:Promise.resolve({jobId:'job'})})).status).toBe(401);
});
it('refuses cross-site cookie retry before reaching the operation',async()=>{
 const token=await mintToken('mxmx_test_notification_csrf');
 const cookie=await agentCookie([token.id]);
 const response=await retry(request('/api/notification-jobs/job/retry',{method:'POST',cookie,headers:{Origin:'https://other.example'}}),{params:Promise.resolve({jobId:'job'})});
 expect(response.status).toBe(403);
});
