import {notificationJobHttp} from '@/lib/notifications';
export async function GET(request:Request,context:{params:Promise<{jobId:string}>}){
 return notificationJobHttp('get_notification_job',request,await context.params);
}
