import {baseUrl} from '@/lib/http';
import {skillTree} from '@/lib/skills';
import {buildHtmlAssets} from '@/lib/html-runtime/build.server';
import {skillPackageFiles,skillZip} from '@/lib/skills/package';
/** The public HTTP author skill; the recipient chooses their harness directory. */
export async function GET(request:Request){
 const files=skillPackageFiles(skillTree(),baseUrl(request));
 files['scripts/preview-runtime.mjs']=`export default ${JSON.stringify(await buildHtmlAssets())};\n`;
 return new Response(skillZip(files),{headers:{
  'Content-Type':'application/zip','Content-Disposition':'attachment; filename="artifactbin.zip"','Cache-Control':'no-store',
 }});
}
