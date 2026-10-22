import type {DatasetBrowserBinding} from "./datasets/planner-contracts.ts";
import {mediaDependencies} from './dependencies.ts';
import {convertMigrationMedia} from './media.ts';
import type {MigrationMediaOptions} from './media-contracts.ts';
import {MAX_PAGE_SOURCE} from '../af-contracts.ts';
import { createHash } from 'node:crypto';
import type { ConversionOutput, Converter, ImportDestination, MigrationManifest, MigrationMaps, MigrationPlan, PlannedPage, PlannedRevision, LegacyRow } from './contracts.ts';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function canonical(value: unknown): string {
 if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
 if(value && typeof value==='object') return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
 return JSON.stringify(value) ?? 'null';
}
function pageId(namespace:string,id:string,occupied:Set<string>):string {
 for(let i=0;i<10000;i++){const candidate=BigInt('0x'+hash(`${namespace}:${id}:${i}`).slice(0,12)).toString(36).padStart(6,'0').slice(-6);if(!occupied.has(candidate))return candidate;}
 throw new Error('Page identity space exhausted');
}
export function allocateMigrationMaps(namespace:string,ids:readonly string[],initial:MigrationMaps):MigrationMaps {
 const maps=structuredClone(initial);const occupied=new Set(Object.values(maps.pages));
 if(occupied.size!==Object.values(maps.pages).length||[...occupied].some(id=>!(/^[a-zA-Z0-9]{6}$/).test(id)))throw new Error('Invalid or duplicate page identity map');
 const sorted=[...new Set(ids)].sort();
 // Reserve valid legacy addresses before assigning replacements so generated IDs cannot steal them.
 for(const id of sorted)if(!maps.pages[id]&&/^[a-zA-Z0-9]{6}$/.test(id)&&!occupied.has(id)){maps.pages[id]=id;occupied.add(id);}
 for(const id of sorted)if(!maps.pages[id]){maps.pages[id]=pageId(namespace,id,occupied);occupied.add(maps.pages[id]!);}
 return maps;
}
export async function planMigration(manifest:MigrationManifest, options:{maps:MigrationMaps;convert:Converter;coreUrl:string;media?:MigrationMediaOptions;datasetBindings?:(legacyId:string,version:number)=>readonly DatasetBrowserBinding[]}):Promise<MigrationPlan> {
 if(manifest.schemaVersion!==1)throw new Error('Unsupported manifest schema');
 const maps=allocateMigrationMaps(manifest.sourceNamespace,manifest.artifacts.map(a=>a.id),options.maps); const occupied=new Set(Object.values(maps.pages));
 if(occupied.size!==Object.values(maps.pages).length || [...occupied].some(id=>!(/^[a-zA-Z0-9]{6}$/).test(id)))throw new Error('Invalid or duplicate page identity map');
 const pages:PlannedPage[]=[];const seen=new Set<string>();
 for(const artifact of [...manifest.artifacts].sort((a,b)=>a.id.localeCompare(b.id))){
  if(seen.has(artifact.id))throw new Error('Duplicate source artifact');seen.add(artifact.id);
  const id=maps.pages[artifact.id]??pageId(manifest.sourceNamespace,artifact.id,occupied); maps.pages[artifact.id]=id;occupied.add(id);
  const issues:string[]=[];
  const ownerKind=artifact.group_id?'group':artifact.user_id?'user':'token';
  const oldOwner=artifact.group_id??artifact.user_id??artifact.token_id;
  const newOwner=maps[ownerKind==='group'?'groups':ownerKind==='user'?'users':'tokens'][oldOwner];
  if(!newOwner)issues.push(`Unmapped ${ownerKind} owner`);
  const revisions:PlannedRevision[]=[];
  const oldRevisions=(manifest.tables.artifact_versions??[]).filter(r=>r.artifact_id===artifact.id);
  const matchingArchives=oldRevisions.filter(r=>Number(r.version)===Number(artifact.version));
  const contentFields=['format','source','document','title','description','meta','actor_user_id','actor_token_id'];
  if(matchingArchives.length>1||matchingArchives.some(r=>contentFields.some(field=>canonical(r[field]??null)!==canonical(artifact[field]??null))))throw new Error('Conflicting archived and current source revision');
  const versions=new Set<number>();
  for(const original of [...oldRevisions.filter(r=>!matchingArchives.includes(r)),artifact].sort((a,b)=>Number(a.version)-Number(b.version))){
   const version=Number(original.version); if(!Number.isSafeInteger(version)||version<1||versions.has(version))throw new Error('Invalid or duplicate source revision');versions.add(version);
   const format=String(original.format); let conversion:ConversionOutput;
   if(format==='markup')conversion=await options.convert({datasetBindings:options.datasetBindings?.(artifact.id,Number(original.version)),resourceMap:options.media?.resourceMap,source:typeof original.source==='string'?original.source:'',document:original.document,meta:original.meta&&typeof original.meta==='object'&&!Array.isArray(original.meta)?original.meta as Record<string,unknown>:undefined,coreUrl:options.coreUrl});
   else if(options.media&&['image','file','pdf'].includes(format))conversion=convertMigrationMedia({format,version,pageId:id,title:String(original.title??artifact.title??''),coreUrl:options.coreUrl,origin:options.media.origin,assets:options.media.assets.filter(a=>a.artifactId===artifact.id)});
   else conversion={classification:'manual-blocked' as const,html:null,issues:[`Unsupported format: ${format}`],identities:{}};
   if(conversion.html!==null){const outputBytes=Buffer.byteLength(conversion.html);conversion={...conversion,outputBytes};if(outputBytes>MAX_PAGE_SOURCE)conversion={...conversion,classification:'manual-blocked',html:null,issues:[...conversion.issues,{code:'destination-source-limit',message:'Converted HTML exceeds destination source limit',outputBytes,limitBytes:MAX_PAGE_SOURCE}]};}
   if(conversion.classification==='manual-blocked'||conversion.html===null)issues.push(`Revision ${version}: blocked format/conversion (${format})`);
   revisions.push({version,original,conversion,...(original===artifact&&matchingArchives.length?{matchingArchives}:{} )});
  }
  const rows=(name:string):LegacyRow[]=>(manifest.tables[name]??[]).filter(row=>row.artifact_id===artifact.id).sort((a,b)=>canonical(a).localeCompare(canonical(b)));
  const liveComments=rows('annotations').filter(c=>!c.deleted_at);
  const commentIds=new Set(liveComments.map(c=>c.id));
  const unavailableCommentContexts:NonNullable<PlannedPage['unavailableCommentContexts']>=[];
  for(const comment of liveComments){
   if(!(maps.users[String(comment.author_user_id)]??maps.tokens[String(comment.author_token_id)]))issues.push('Unmapped live comment author');
   if(!versions.has(Number(comment.anchor_version??artifact.version)))unavailableCommentContexts.push({commentId:String(comment.id),status:'unavailable',originalRevision:String(comment.anchor_version??artifact.version),reason:'not-retained'});
   if(comment.root_id&&!commentIds.has(comment.root_id))issues.push('Comment references missing root');
  }
  pages.push({legacyId:artifact.id,pageId:id,owner:newOwner?{kind:ownerKind,id:newOwner}:null,disposition:issues.length?'blocked':'ready',issues,revisions,access:{visibility:artifact.visibility,linkRole:artifact.link_role??'viewer',shares:rows('artifact_shares')},original:artifact,assetDependencies:[...new Set(revisions.flatMap(r=>r.conversion.html?mediaDependencies(r.conversion.html,id):[]))].sort(),assets:options.media?.assets.filter(a=>a.artifactId===artifact.id&&versions.has(a.version)).map(a=>({revision:String(a.version),variant:a.variant,sha256:a.sha256,contentType:a.contentType,filename:a.filename,bytes:a.bytes})),comments:rows('annotations'),unavailableCommentContexts,identities:rows('artifact_source_ids')});
 }
 return {schemaVersion:1,sourceNamespace:manifest.sourceNamespace,maps,pages,archive:manifest};
}
export const migrationPageDigest=(page:PlannedPage):string=>hash(canonical(page));
export async function applyMigration(plan:MigrationPlan,destination:ImportDestination,options:{dryRun:boolean;globallyReadyPages?:ReadonlySet<string>}):Promise<{created:number;unchanged:number;blocked:number}>{
 const result={created:0,unchanged:0,blocked:0};
 // Preflight the entire batch before allowing any mutation.
 if(!options.dryRun)for(const page of plan.pages)if(page.disposition==='ready'&&page.assetDependencies?.length&&!options.globallyReadyPages?.has(page.pageId))throw new Error('Global media dependency preflight required');
 if(!options.dryRun) for(const page of plan.pages)if(page.disposition==='ready'&&!destination.supportsExactAccess(page))throw new Error('Destination cannot preserve exact access semantics');
 for(const page of plan.pages){
  if(page.disposition==='blocked'||!destination.supportsExactAccess(page)){result.blocked++;continue;}
  if(options.dryRun)continue;
  const outcome=await destination.importPage(`${plan.sourceNamespace}:${page.legacyId}`,migrationPageDigest(page),page);result[outcome]++;
 }
 return result;
}
