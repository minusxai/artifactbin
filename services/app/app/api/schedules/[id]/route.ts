import {scheduleRequest} from '@/lib/runner';
export const GET=(request:Request,{params}:{params:Promise<{id:string}>})=>params.then(p=>scheduleRequest(request,p.id));
export const PATCH=GET;
export const DELETE=GET;
