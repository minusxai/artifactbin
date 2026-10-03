import {deleteSchedule} from '@/lib/runner';
export const DELETE=(request:Request,{params}:{params:Promise<{id:string}>})=>params.then(p=>deleteSchedule(request,p.id));
