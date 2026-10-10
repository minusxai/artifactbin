import {baseUrl} from '@/lib/http';
import {skillTree} from '@/lib/skills';
import {skillPackageFiles,skillZip} from '@/lib/skills/package';
/** The same folder CLI setup installs; the recipient chooses their harness directory. */
export async function GET(request:Request){
 return new Response(skillZip(skillPackageFiles(skillTree(),baseUrl(request))),{headers:{
  'Content-Type':'application/zip','Content-Disposition':'attachment; filename="artifactbin.zip"','Cache-Control':'no-store',
 }});
}
