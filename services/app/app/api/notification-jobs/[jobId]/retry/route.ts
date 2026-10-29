import { notificationJobHttp } from '@/lib/operations';
export async function POST(request:Request,context:{params:Promise<{jobId:string}>}){
 return notificationJobHttp('retry_notification_job',request,await context.params);
}
