import {runRequest} from '@/lib/runner';
export const GET=(request:Request,{params}:{params:Promise<{id:string}>})=>params.then(p=>runRequest(request,p.id,'get'));
