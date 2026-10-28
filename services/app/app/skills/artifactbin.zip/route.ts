import {baseUrl} from '@/lib/http';
import {skillTree} from '@/lib/skills';
import {buildPreviewParser,buildPreviewDatasets,buildToolboxPlatform} from '@/lib/skills/preview-assets.server';
import {skillPackageFiles,skillZip} from '@/lib/skills/package';
/** The public HTTP author skill; the recipient chooses their harness directory. Only what agents read and run ships (D20):
 * no fonts (D16), compiled components or runtime/library bundles — pages and the local preview load those from the
 * platform (/af/fonts/, /af/components/, /af/*.js, /libraries/). */
export async function GET(request:Request){
 const files=skillPackageFiles(skillTree(),baseUrl(request));
 files['scripts/toolbox-config.mjs']='export default '+JSON.stringify(new URL(baseUrl(request)).origin)+';\n';
 files['scripts/preview-html.mjs']=await buildPreviewParser(files['scripts/preview-html.mjs']!);
 files['scripts/preview-datasets.mjs']=await buildPreviewDatasets();
 files['scripts/toolbox-platform.mjs']=await buildToolboxPlatform();
 return new Response(skillZip(files),{headers:{
  'Content-Type':'application/zip','Content-Disposition':'attachment; filename="artifactbin.zip"','Cache-Control':'no-store',
 }});
}
