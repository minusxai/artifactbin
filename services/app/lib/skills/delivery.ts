import {createHash} from 'node:crypto';
import {baseUrl} from '@/lib/http';
import {ALIAS_ORIGINS, IS_DEV, PUBLIC_BASE_URL} from '@/lib/platform';
import {buildSkillTree,loadSkillSources} from './tree';
import {skillPackageFiles,skillRelease} from './package';
import {buildPreviewParser,buildPreviewDatasets,buildToolboxPlatform} from './preview-assets.server';
/** The server the installed skill talks to: the request's own origin, except that an alias (APP__ALIAS_ORIGINS)
 * names the canonical APP__PUBLIC_BASE_URL, so an archive fetched through a previous hostname still points at
 * the current one. */
export function skillServer(request:Request):string{
 const origin=new URL(baseUrl(request)).origin;
 return ALIAS_ORIGINS.includes(origin)?new URL(PUBLIC_BASE_URL).origin:origin;
}
/** One archive per server origin, for the few origins this server answers as (the request's host names it, so the
 * set is bounded): its inputs are this build's files (development reads them anew on each request). */
const ARCHIVE_ORIGINS=4;
const archives=new Map<string,Promise<Awaited<ReturnType<typeof buildArchive>>>>();
async function buildArchive(server:string){
 const files=skillPackageFiles(buildSkillTree(loadSkillSources()),server);
 files['scripts/toolbox-config.mjs']='export default '+JSON.stringify(server)+';\n';
 files['scripts/preview-html.mjs']=await buildPreviewParser(files['scripts/preview-html.mjs']!);
 files['scripts/preview-datasets.mjs']=await buildPreviewDatasets();
 files['scripts/toolbox-platform.mjs']=await buildToolboxPlatform();
 const {bytes,manifest}=skillRelease(files,server);
 return {bytes,manifest,etag:`"${createHash('sha256').update(bytes).digest('base64url').slice(0,22)}"`};
}
export function archiveFor(server:string){
 if(IS_DEV)return buildArchive(server);
 let built=archives.get(server);
 if(!built){built=buildArchive(server);archives.set(server,built);if(archives.size>ARCHIVE_ORIGINS)archives.delete(archives.keys().next().value!);void built.catch(()=>{if(archives.get(server)===built)archives.delete(server);});}
 return built;
}
