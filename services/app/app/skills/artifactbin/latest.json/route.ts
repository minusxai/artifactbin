import {archiveFor,skillServer} from '@/lib/skills';
export async function GET(request:Request){
 const {manifest}=await archiveFor(skillServer(request));
 return Response.json(manifest,{headers:{'Cache-Control':'public, max-age=300'}});
}
