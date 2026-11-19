import {createHash} from 'node:crypto';
import {baseUrl} from '@/lib/http';
import {ALIAS_ORIGINS, IS_DEV, PUBLIC_BASE_URL} from '@/lib/platform';
import {buildSkillTree,loadSkillSources} from './tree';
import {skillPackageFiles,skillRelease} from './package';
import {loadSkillAssets} from './assets';
import {skillExtras,type SkillExtras} from './extras';
import {buildPreviewParser,buildToolboxPlatform,compactSkillScript} from './preview-assets.server';
/** The server the installed skill talks to: the request's own origin, except that an alias (APP__ALIAS_ORIGINS)
 * names the canonical APP__PUBLIC_BASE_URL, so an archive fetched through a previous hostname still points at
 * the current one. */
export function skillServer(request:Request):string{
 const origin=new URL(baseUrl(request)).origin;
 return ALIAS_ORIGINS.includes(origin)?new URL(PUBLIC_BASE_URL).origin:origin;
}
/** One archive per server origin, for the few origins this server answers as (the request's host names it, so the
 * set is bounded): its inputs are this build's files and the current extras (development builds anew on each request). */
const ARCHIVE_ORIGINS=4;
const archives=new Map<string,{extras:SkillExtras|null;built:Promise<Awaited<ReturnType<typeof buildArchive>>>}>();
async function buildArchive(server:string,extras:SkillExtras|null){
 const files=skillPackageFiles(buildSkillTree(loadSkillSources()),server,loadSkillAssets(),extras);
 // Compact raw executable sources before replacing generated bundles below. Guides and examples stay verbatim.
 await Promise.all(Object.entries(files).filter(([name])=>name.startsWith('scripts/')&&!['scripts/preview-html.mjs','scripts/toolbox-platform.mjs'].includes(name)).map(async([name,source])=>{files[name]=await compactSkillScript(source);}));
 files['scripts/toolbox-config.mjs']='export default '+JSON.stringify(server)+';\n';
 files['scripts/preview-html.mjs']=await buildPreviewParser(files['scripts/preview-html.mjs']!);
 files['scripts/toolbox-platform.mjs']=await buildToolboxPlatform();
 const {bytes,manifest}=skillRelease(files,server);
 return {bytes,manifest,etag:`"${createHash('sha256').update(bytes).digest('base64url').slice(0,22)}"`};
}
/**
 * NAMED ARCHIVES: an updater reads latest.json, then fetches the archive it names; the directory (or a deploy) may
 * change between the two requests, and both may sit in shared caches for their max-age apart. So every archive a
 * manifest named stays fetchable, by `?sha256=<its hash>` (archiveNamed), for NAMED_MS after the last manifest that
 * named it, at most NAMED_KEPT of them per process (about 2 MB each). The manifest's own `url` stays the plain
 * address, which installed updaters require exactly; current updaters add the query themselves.
 */
const NAMED_MS=15*60_000,NAMED_KEPT=8;
type Release=Awaited<ReturnType<typeof buildArchive>>;
const named=new Map<string,{release:Release;at:number}>();
/** The archive for this origin as latest.json names it, held so that its own address answers it afterwards. */
export async function manifestFor(server:string){
 const release=await archiveFor(server);
 const key=`${server}\n${release.manifest.sha256}`,now=Date.now();
 named.delete(key);named.set(key,{release,at:now});
 for(const [held,{at}] of named)if(named.size>NAMED_KEPT||now-at>NAMED_MS)named.delete(held);else break;
 return release;
}
/** The archive with this SHA-256 that a manifest for this origin named within NAMED_MS, or null. */
export function archiveNamed(server:string,sha256:string):Release|null{
 const held=named.get(`${server}\n${sha256}`);
 return held&&Date.now()-held.at<=NAMED_MS?held.release:null;
}
export function archiveFor(server:string){
 // Extras (SKILLS__EXTRA_DIR) follow their directory: skillExtras() returns a new object only when their files
 // changed, so one archive per origin is rebuilt exactly then, and every request meanwhile shares one build.
 const extras=skillExtras();
 if(IS_DEV)return buildArchive(server,extras);
 const held=archives.get(server);
 if(held?.extras===extras)return held.built;
 const built=buildArchive(server,extras);
 archives.delete(server);archives.set(server,{extras,built});
 if(archives.size>ARCHIVE_ORIGINS)archives.delete(archives.keys().next().value!);
 void built.catch(()=>{if(archives.get(server)?.built===built)archives.delete(server);});
 return built;
}
