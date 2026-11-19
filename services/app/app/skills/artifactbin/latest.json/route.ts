import {manifestFor,skillServer} from '@/lib/skills';
export async function GET(request:Request){
 // The archive it names stays fetchable at `<url>?sha256=<sha256>` after the directory or build moves on.
 const {manifest}=await manifestFor(skillServer(request));
 return Response.json(manifest,{headers:{'Cache-Control':'public, max-age=300'}});
}
