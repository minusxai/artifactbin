import {matchingTag} from '@/lib/http';
import {archiveFor,skillServer} from '@/lib/skills';
export async function GET(request:Request){
 const {bytes,etag}=await archiveFor(skillServer(request));
 // Shared caches may keep it a few minutes; a revalidation with the same bytes is a 304.
 const headers={'Cache-Control':'public, max-age=300','ETag':etag};
 if(matchingTag(request.headers.get('if-none-match'),etag))return new Response(null,{status:304,headers});
 return new Response(bytes,{headers:{...headers,'Content-Type':'application/zip','Content-Disposition':'attachment; filename="artifactbin.zip"'}});
}
