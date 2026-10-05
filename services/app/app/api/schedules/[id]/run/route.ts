import {scheduleRequest} from '@/lib/runner';
export const POST=(request:Request,{params}:{params:Promise<{id:string}>})=>params.then(p=>scheduleRequest(request,p.id,'run'));
