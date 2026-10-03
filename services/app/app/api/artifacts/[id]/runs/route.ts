import {invokeArtifact} from '@/lib/runner';
export const POST=(request:Request,{params}:{params:Promise<{id:string}>})=>params.then(p=>invokeArtifact(request,p.id));
