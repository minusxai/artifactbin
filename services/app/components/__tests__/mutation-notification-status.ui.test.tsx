import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MutationNotificationStatus} from '../MutationNotificationStatus';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('lists run jobs and retries only the failed notification without resending a mutation',async()=>{
 let retried=false;const calls:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{calls.push(`${init?.method??'GET'} ${url}`);if(init?.method==='POST'){retried=true;return Response.json({ok:true});}return Response.json({jobs:[{id:'job',notification_name:'status_notice',status:retried?'pending':'failed',attempts:1,error_code:retried?null:'notification_execution_failed'},{id:'done',notification_name:'other_notice',status:'completed',attempts:1,error_code:null}]});}));
 render(<MutationNotificationStatus runId="run"/>);
 expect(await screen.findByText('Failed')).toBeVisible();expect(screen.getByText('Completed')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Retry notification status_notice'}));
 await waitFor(()=>expect(screen.getByText('Pending')).toBeVisible());expect(calls).toContain('POST /api/notification-jobs/job/retry');expect(calls.every(c=>c.includes('/notification-'))).toBe(true);
});
it('reports unavailable runs without showing retry or invented status',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({jobs:[]})));render(<MutationNotificationStatus runId="private"/>);
 expect(await screen.findByText('No notification jobs are available for this run.')).toBeVisible();expect(screen.queryByRole('button',{name:/Retry notification/})).toBeNull();
});
