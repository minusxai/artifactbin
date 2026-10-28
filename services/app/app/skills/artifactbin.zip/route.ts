import {baseUrl} from '@/lib/http';
import {ALIAS_ORIGINS,PUBLIC_BASE_URL} from '@/lib/platform/config';
import {skillTree} from '@/lib/skills';
import {buildPreviewParser,buildPreviewDatasets,buildToolboxPlatform} from '@/lib/skills/preview-assets.server';
import {skillPackageFiles,skillZip} from '@/lib/skills/package';
/** The public HTTP author skill; the recipient chooses their harness directory. Only what agents read and run ships (D20):
 * no fonts (D16), compiled components or runtime/library bundles — pages and the local preview load those from the
 * platform (/af/fonts/, /af/components/, /af/*.js, /libraries/). */
/** The server the installed skill talks to: the request's own origin, except that an alias (APP__ALIAS_ORIGINS)
 * names the canonical APP__PUBLIC_BASE_URL, so an archive fetched through a previous hostname still points at
 * the current one. */
function skillServer(request:Request):string{
 const origin=new URL(baseUrl(request)).origin;
 return ALIAS_ORIGINS.includes(origin)?new URL(PUBLIC_BASE_URL).origin:origin;
}
export async function GET(request:Request){
 const server=skillServer(request);
 const files=skillPackageFiles(skillTree(),server);
 files['scripts/toolbox-config.mjs']='export default '+JSON.stringify(server)+';\n';
 files['scripts/preview-html.mjs']=await buildPreviewParser(files['scripts/preview-html.mjs']!);
 files['scripts/preview-datasets.mjs']=await buildPreviewDatasets();
 files['scripts/toolbox-platform.mjs']=await buildToolboxPlatform();
 return new Response(skillZip(files),{headers:{
  'Content-Type':'application/zip','Content-Disposition':'attachment; filename="artifactbin.zip"','Cache-Control':'no-store',
 }});
}
