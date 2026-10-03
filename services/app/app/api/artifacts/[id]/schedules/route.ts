import {artifactSchedule} from '@/lib/runner';
export const POST=(request:Request,{params}:{params:Promise<{id:string}>})=>params.then(p=>artifactSchedule(request,p.id));
export const GET=POST;
