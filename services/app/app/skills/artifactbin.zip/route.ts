import {createHash} from 'node:crypto';
import {baseUrl} from '@/lib/http';
import {matchingTag} from '@/lib/http/revalidation';
import {ALIAS_ORIGINS,IS_DEV,PUBLIC_BASE_URL} from '@/lib/platform/config';
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
/** One archive per server origin, for the few origins this server answers as (the request's host names it, so the
 * set is bounded): its inputs are this build's files (development reads them anew on each request). */
const ARCHIVE_ORIGINS=4;
const archives=new Map<string,Promise<{bytes:Uint8Array<ArrayBuffer>;etag:string}>>();
async function buildArchive(server:string){
 const files=skillPackageFiles(skillTree(),server);
 files['scripts/toolbox-config.mjs']='export default '+JSON.stringify(server)+';\n';
 files['scripts/preview-html.mjs']=await buildPreviewParser(files['scripts/preview-html.mjs']!);
 files['scripts/preview-datasets.mjs']=await buildPreviewDatasets();
 files['scripts/toolbox-platform.mjs']=await buildToolboxPlatform();
 const bytes=skillZip(files);
 return {bytes,etag:`"${createHash('sha256').update(bytes).digest('base64url').slice(0,22)}"`};
}
function archiveFor(server:string){
 if(IS_DEV)return buildArchive(server);
 let built=archives.get(server);
 if(!built){built=buildArchive(server);archives.set(server,built);if(archives.size>ARCHIVE_ORIGINS)archives.delete(archives.keys().next().value!);void built.catch(()=>{if(archives.get(server)===built)archives.delete(server);});}
 return built;
}
export async function GET(request:Request){
 const {bytes,etag}=await archiveFor(skillServer(request));
 // Shared caches may keep it a few minutes; a revalidation with the same bytes is a 304.
 const headers={'Cache-Control':'public, max-age=300','ETag':etag};
 if(matchingTag(request.headers.get('if-none-match'),etag))return new Response(null,{status:304,headers});
 return new Response(bytes,{headers:{...headers,'Content-Type':'application/zip','Content-Disposition':'attachment; filename="artifactbin.zip"'}});
}
