import {localConnectionStatus} from '@/lib/local-connection';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return localConnectionStatus(request,(await context.params).id);}
