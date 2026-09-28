import {notificationJobHttp} from '@/lib/notification-job-http';
export async function GET(request:Request,context:{params:Promise<{runId:string}>}){
 return notificationJobHttp('list_notification_jobs',request,await context.params);
}
