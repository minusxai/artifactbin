import {matchingTag} from '@/lib/http';
import {archiveFor,archiveNamed,skillServer} from '@/lib/skills';
export async function GET(request:Request){
 const server=skillServer(request),wanted=new URL(request.url).searchParams.get('sha256');
 // `?sha256=` asks for the archive a manifest named: its bytes never change, or it is no longer held.
 if(wanted!==null){
  // Not named by this process (it restarted, or another answered latest.json): the current archive, if it is that one.
  const current=/^[a-f0-9]{64}$/.test(wanted)?archiveNamed(server,wanted)??await archiveFor(server):null;
  const named=current?.manifest.sha256===wanted?current:null;
  if(!named)return new Response('That archive is no longer held: read latest.json again.\n',{status:404,headers:{'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8'}});
  return archiveResponse(request,named,'public, max-age=31536000, immutable');
 }
 // Shared caches may keep it a few minutes; a revalidation with the same bytes is a 304.
 return archiveResponse(request,await archiveFor(server),'public, max-age=300');
}
function archiveResponse(request:Request,{bytes,etag}:Awaited<ReturnType<typeof archiveFor>>,cache:string){
 const headers={'Cache-Control':cache,'ETag':etag};
 if(matchingTag(request.headers.get('if-none-match'),etag))return new Response(null,{status:304,headers});
 return new Response(bytes,{headers:{...headers,'Content-Type':'application/zip','Content-Disposition':'attachment; filename="artifactbin.zip"'}});
}
