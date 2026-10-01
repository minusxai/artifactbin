import {notificationJobHttp} from '@/lib/notifications';
export async function GET(request:Request,context:{params:Promise<{runId:string}>}){
 return notificationJobHttp('list_notification_jobs',request,await context.params);
}
