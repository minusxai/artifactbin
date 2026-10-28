/** Import converted pages into artefactbin in one transaction with a fixed number of queries.
 * Same page, asset and dataset ids, owners, authors and emails as the source.
 * Usage: tsx scripts/import-pages.mts CONFIG.json [--apply] ID...
 *  without --apply: builds every row and uploads nothing; prints counts.
 *  with --apply: uploads files to S3, then writes all pages in one transaction and reads them back.
 * Dataset-only: tsx scripts/import-pages.mts CONFIG.json --datasets [--apply] ID...
 *  imports just these datasets from the config's shared catalog (same ids, owners, visibility and shares),
 *  after checking each one against old prod as it is now (read-only); existing ids are skipped.
 *  Image artifacts (single version, e.g. a page's og:image) are copied from old prod the same way, bytes checked against their sha256.
 */
import fs from 'node:fs/promises';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';import {createHash,randomBytes} from 'node:crypto';import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {readNativeMigrationHostInputs} from './lib/native-migration-host.mjs';
import {nativeProductPublicationModules} from './lib/native-migration-bootstrap';
import {canonicalizeHtmlPage} from '../services/app/lib/html-page';
import {planPublicationBundle,publishBundleDependencies} from '../services/app/lib/html-publication-bundle';
import {fileContentType} from '@artifactbin/contracts';
import {prepareNativeArtifactRelations} from '../services/app/lib/native-history-import/artifact-relations';
import {prepareNativeHistoryRelations} from '../services/app/lib/native-history-import/relations';
import {canonicalNativeObjectSource,verifyNativeCanonicalDatasets} from '../services/app/lib/native-history-import/catalog-source';
import {createNativeS3ObjectSink} from '../services/app/lib/native-history-import/catalog-staging';
import {deriveNativeUserObject} from '../services/app/lib/native-history-import/catalog-user-remap';
import {storedUser,nativeIdentityDigest} from '../services/app/lib/native-identity-import/model';
import {parseS3Url} from '../services/app/lib/object-store/url';

interface Config{oldSchema?:string;oldS3Prefix?:string;extraTokens?:Record<string,unknown>[];hostHeads?:Record<string,string>;converted?:Record<string,{result:string;manifest:string}>;codec:string;publicationModule:string;publicationConfiguration:string;runtimeEnvironment:string;origin:string;port?:number}
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const ID_ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const newId=()=>[...randomBytes(6)].map(b=>ID_ALPHABET[b%62]).join('');
const newEditId=()=>randomBytes(16).toString('hex');
const iso=(v:unknown)=>v===null||v===undefined?null:new Date(String(v)).toISOString();
const fail=(code:string):never=>{throw Error('import_pages_'+code);};

type Row=Record<string,unknown>;
/** Every table this importer writes, in dependency order. One bulk insert per table per run. */
const TABLES=['users','auth_user','tokens','artifact_id_registry','artifacts','artifact_versions','artifact_edits','artifact_source_ids','html_backend_versions','artifact_shares','dataset_policy_audit','annotations','comment_images','relations'] as const;
type Table=typeof TABLES[number];
interface Batch{rows:Record<Table,Row[]>;objects:Map<string,{bytes:Buffer;contentType?:string}>;pages:{id:string;assets:number;datasets:string[];comments:number;members:number}[];datasetIds:Set<string>;unverifiedDatasets:Set<string>}

/** A page packaged by the old host builder: sealed context plus operator input files. */
async function packagedInput(cfg:Config,id:string,codec:any){
 // A context re-sealed for the production schemas (context.json) wins over the converter's original (host-context.json).
 const dir=cfg.hostHeads?.[id]??fail('no_input:'+id),wire=JSON.parse(await fs.readFile(path.join(dir,'context.json'),'utf8').catch(()=>fs.readFile(path.join(dir,'host-context.json'),'utf8')));
 return readNativeMigrationHostInputs(codec.decodeNativePipelineContext(wire));
}
/** Converter bytes are saved as JSON objects or Buffer JSON; restore them. */
const bytesOf=(raw:any)=>raw instanceof Uint8Array?raw:raw?.type==='Buffer'?Uint8Array.from(raw.data):Uint8Array.from(Object.keys(raw).sort((a,b)=>Number(a)-Number(b)).map(k=>raw[k]));
/** A page straight from the converter's output: its result, its batch manifest and the shared publication config. */
async function convertedInput(cfg:Config,id:string,config:any){
 const {result:resultPath,manifest:manifestPath}=cfg.converted![id]!,producer=path.dirname(cfg.codec),consumer=path.dirname(cfg.publicationModule);
 const [{selectLatestHead},{selectNativePipelineRelations},{decodeNativePublicationBytes}]=await Promise.all([import(pathToFileURL(producer+'/latest-batch-prepare.ts').href),import(pathToFileURL(consumer+'/pipeline-relations.ts').href),import(pathToFileURL(consumer+'/pipeline-publication.ts').href)]);
 const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8')),head=manifest.heads.find((h:any)=>h.key.sourceId===id)??fail('manifest_head:'+id);
 const canonical=await fs.readFile(head.sourceFile.path),revision=selectLatestHead(head,canonical,manifest.identityPlanSha256);
 const result=JSON.parse(await fs.readFile(resultPath,'utf8'));if(result.status!=='assembled')fail('not_converted:'+id);
 const assembly=result.assembly;for(const files of [assembly.input.files,assembly.result.files])for(const f of files??[])f.bytes=bytesOf(f.bytes);
 const files:Record<string,Uint8Array>={sourceHead:canonical,compiledHtml:Buffer.from(assembly.result.html),comments:await selectNativePipelineRelations(config,revision)};
 if(config.ancillaryFolders)files.ancillaryFolders=decodeNativePublicationBytes(config.ancillaryFolders);
 return {context:{revision,assembly},recipe:{assemblySha256:assembly.sha256,authority:{...config.shared.schemas,capabilities:['live-operator-schema-check']}},files};
}
/** Dataset rows and data objects from a converted catalog: every dataset in it, or only the ids in `only`.
 * Datasets are shared between pages, so each is written once and skipped if it already exists. */
async function prepareDatasets(catalog:any,batch:Batch,only?:ReadonlySet<string>){
 const projection=only?{...catalog.projection,datasets:catalog.projection.datasets.filter((d:any)=>only.has(d.targetId)),typedUserRemaps:(catalog.projection.typedUserRemaps??[]).filter((r:any)=>only.has(r.sourceId))}:catalog.projection;
 const source=await canonicalNativeObjectSource(catalog.root,catalog.ledgerPath,catalog.receipts);
 // The Oct 24 export files behind some catalogs are gone; their projection rows still import, flagged as unverified.
 try{await verifyNativeCanonicalDatasets(projection,source.source);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;for(const d of projection.datasets)batch.unverifiedDatasets.add(d.targetId);}
 const keys=new Set<string>();
 for(const d of projection.datasets){
  if(batch.datasetIds.has(d.targetId))continue;batch.datasetIds.add(d.targetId);
  const a=d.authority,v=d.versions.find((x:any)=>x.version===d.currentVersion);
  for(const version of d.versions)for(const t of version.meta?.catalog?.tables??[])if(t.objectKey)keys.add(t.objectKey);
  if(v.meta?.objectKey)keys.add(v.meta.objectKey);
  batch.rows.artifact_id_registry.push({id:d.targetId,owner:a.creatorUserId??a.userId??a.tokenId,consumed:true});
  batch.rows.artifacts.push({id:d.targetId,token_id:a.tokenId,user_id:a.userId,group_id:a.groupId,creator_user_id:a.creatorUserId,visibility:a.visibility,link_role:a.linkRole,access:a.access,dataset_policy:a.datasetPolicy,sharing_revision:a.sharingRevision,policy_revision:a.policyRevision,
   ancestor_ids:[...a.ancestorIds],version:v.version,format:'dataset',source:v.source,meta:v.meta,title:v.title,description:v.description,edit_id:a.editId,actor_user_id:v.actorUserId,actor_token_id:v.actorTokenId,created_at:iso(a.createdAt),updated_at:iso(a.updatedAt),deleted_at:iso(a.deletedAt)});
  for(const x of d.versions)batch.rows.artifact_versions.push({artifact_id:d.targetId,version:x.version,title:x.title,description:x.description,format:'dataset',source:x.source,meta:x.meta,actor_user_id:x.actorUserId,actor_token_id:x.actorTokenId,created_at:iso(x.createdAt)});
  for(const s of a.shares)batch.rows.artifact_shares.push({artifact_id:d.targetId,email:s.email.trim().toLowerCase(),role:s.role});
  batch.rows.artifact_edits.push({artifact_id:d.targetId,edit_id:a.editId,splice_start:0,removed:'',inserted:v.source??'',span_start:0,span_end:0,actor_user_id:v.actorUserId,actor_token_id:v.actorTokenId,document_state:{version:d.currentVersion}});
  for(const p of d.policyAudit)batch.rows.dataset_policy_audit.push({dataset_id:d.targetId,revision:p.revision,policy:p.policy,actor_user_id:p.actorUserId,actor_token_id:p.actorTokenId,created_at:iso(p.createdAt)});
 }
 for(const o of projection.objects)if(keys.has(o.objectKey)){const bytes=await source.source.read(o);if(bytes.length!==o.bytes||sha(bytes)!==o.sha256)fail('dataset_object_digest:'+o.objectKey);batch.objects.set(o.targetKey,{bytes,contentType:o.contentType});}
 // Tables with user-typed cells point at a derived object (user ids remapped) that no source holds: derive it again from its source object.
 // The derived bytes must match the receipt's digest and size (the receipt's own seal was computed elsewhere, so it is not compared).
 for(const r of projection.typedUserRemaps??[])if(keys.has(r.targetKey)){
  const o=projection.objects.find((x:any)=>x.objectKey===r.sourceObjectKey&&x.targetKey===x.objectKey)??fail('dataset_remap_source_missing:'+r.sourceObjectKey);
  const {sourceId,version,schema,table,sourceMetaSha256,sourceObjectKey,userColumns}=r,derived=deriveNativeUserObject({sourceId,version,schema,table,sourceMetaSha256,sourceObjectKey,userColumns},await source.source.read(o),projection.identities.users,projection.identityPlanSha256??'');
  if(!derived||derived.receipt.targetKey!==r.targetKey||derived.receipt.targetSha256!==r.targetSha256||derived.receipt.targetBytes!==r.targetBytes||derived.receipt.changedCells!==r.changedCells)fail('dataset_remap_derivation:'+r.targetKey);
  batch.objects.set(r.targetKey,{bytes:derived.bytes,contentType:'application/json'});
 }
 for(const key of keys)if(!batch.objects.has(key))fail('dataset_object_missing:'+key);
}

/** Rows for one single-version stored-object artifact (a page asset file, or an image), owned and acted on by one user. */
function fileArtifactRows(batch:Batch,x:{id:string;userId:string;tokenId:string;title:unknown;format:'file'|'image';meta:unknown;visibility:string;shares:{email:string;role:string}[];editId:string;createdAt:unknown;updatedAt:unknown}){
 batch.rows.artifact_id_registry.push({id:x.id,owner:x.userId,consumed:true});
 batch.rows.artifacts.push({id:x.id,token_id:x.tokenId,user_id:x.userId,creator_user_id:x.userId,title:x.title,format:x.format,meta:x.meta,
  visibility:x.visibility,ancestor_ids:[],edit_id:x.editId,access:'read',actor_user_id:x.userId,actor_token_id:x.tokenId,version:1,sharing_revision:x.shares.length?1:0,policy_revision:0,created_at:iso(x.createdAt),updated_at:iso(x.updatedAt)});
 batch.rows.artifact_edits.push({artifact_id:x.id,edit_id:x.editId,splice_start:0,removed:'',inserted:'',span_start:0,span_end:0,actor_user_id:x.userId,actor_token_id:x.tokenId,document_state:{epoch:null,version:1}});
 for(const s of x.shares)batch.rows.artifact_shares.push({artifact_id:x.id,email:s.email.trim().toLowerCase(),role:s.role});
}

/** Build one page's rows from its converted package. No database or network access. */
async function preparePage(cfg:Config,id:string,batch:Batch,codec:any,publication:any,publicationConfig:any){
 const input=cfg.converted?.[id]?await convertedInput(cfg,id,publicationConfig):await packagedInput(cfg,id,codec),context=input.context;
 const assets:Row[]=[];
 // Assets are created here, offline: the product's bundle publisher rewrites the HTML and asks us for each id.
 const prepareRuntime=async(assemblies:any[],options:{pageId:string;visibility:string;shares?:{email:string;role:string}[]})=>{
  if(assemblies.length!==1)fail('latest_only');
  const assembly=assemblies[0],result=assembly.result;
  if(result.files.some((f:any)=>fileContentType(f.path)==='application/pdf'))fail('pdf_unsupported:'+id);
  const files=result.files.map((f:any)=>({path:f.path,contentType:fileContentType(f.path)??'application/octet-stream',base64:Buffer.from(f.bytes).toString('base64')}));
  const plan=planPublicationBundle(result.html,{entryPath:'index.html',files});
  if(plan.backends.length||plan.dependencies.some((d:any)=>d.kind!=='asset'))fail('bundle_backend_or_dataset:'+id);
  const published=await publishBundleDependencies(plan,sha(id+':'+assembly.sha256),{
   reuse:async()=>fail('bundle_reuse'),update:async()=>fail('bundle_update'),
   async create(dep:any){
    const assetId=newId(),bytes=Buffer.from(dep.base64,'base64'),hash=sha(bytes),filename=dep.path.split('/').at(-1),objectKey='file/'+hash.slice(0,32);
    batch.objects.set(objectKey,{bytes,contentType:dep.contentType});
    assets.push({id:assetId,filename,contentType:dep.contentType,bytes:bytes.length,sha256:hash,objectKey,visibility:options.visibility??'unlisted',shares:options.shares??[]});
    return {id:assetId,revision:'1',address:`/a/${options.pageId}/assets?dependency=${assetId}&revision=1`};
   }});
  const staged={pageId:options.pageId,key:{...assembly.key},assemblySha256:assembly.sha256,sourceHtmlSha256:result.htmlSha256,html:published.html,htmlSha256:sha(published.html),
   fileDigests:result.files.map((f:any)=>({path:f.path,sha256:f.sha256})),dependencies:published.receipts,objects:[] as unknown[]};
  const proof={...staged,assetsSha256:sha(JSON.stringify(staged))};
  return {staged:[proof],prepareBundle:()=>proof};
 };
 const recipe=await publication({context,reviewedRecipe:input.recipe,files:input.files,prepareRuntime,publicationModules:nativeProductPublicationModules});
 const {history,identity,catalog}=recipe;
 // Membership source files travel base64-encoded; decode and check their digests.
 for(const [field,value] of Object.entries(recipe.membership.source??{}) as [string,any][]){
  if(value===undefined||value instanceof Uint8Array)continue;
  const bytes=Buffer.from(value.data,'base64');if(value.encoding!=='base64'||sha(bytes)!==value.sha256)fail('membership_source:'+field);
  recipe.membership.source[field]=bytes;
 }
 if(history.revisions.length!==1)fail('latest_only');
 const r=history.revisions[0],owner=history.owner,html=r.page.html;
 if(r.page.links.some((l:any)=>l.kind==='dataset'&&l.mode==='live'))fail('live_dataset_link:'+id);
 if(catalog.projection.typedUserRemaps?.length||catalog.projection.externalConnections?.length)fail('dataset_remap_or_connection:'+id);

 // People: the page's owner, authors, commenters and members, already mapped to target ids by the converter.
 const plan=identity.plan;
 for(const u of plan.createUsers){const s=storedUser(u);batch.rows.users.push({...s,expires_at:iso(s.expires_at),created_at:iso(s.created_at)});
  if(s.kind==='account'&&s.email)batch.rows.auth_user.push({id:s.id,name:s.name??'',email:s.email.trim().toLowerCase(),emailVerified:false,image:null,createdAt:iso(identity.revokedAt),updatedAt:iso(identity.revokedAt)});}
 for(const t of plan.tokens){const revokedAt=iso(identity.revokedAt);batch.rows.tokens.push({id:t.targetId,user_id:t.userId,token_hash:'!native-provenance:v1:'+nativeIdentityDigest([plan.sourceNamespace,t.sourceId,t.sourceRowSha256]),name:'imported provenance (disabled)',created_at:iso(t.sourceCreatedAt??identity.revokedAt),deleted_at:revokedAt,expires_at:revokedAt,request_authority:false});}

 // The page.
 const membership=prepareNativeArtifactRelations(recipe.membership),relations=prepareNativeHistoryRelations(recipe.relations,membership);
 const meta={htmlIdentity:r.ledger,htmlLinks:r.page.links,nativeImport:{sourceNamespace:history.sourceNamespace,sourceId:history.sourceId},
  ...(r.template===undefined?{}:{template:r.template}),...(r.htmlPublicationDependencies===undefined?{}:{htmlPublicationDependencies:r.htmlPublicationDependencies}),...relations.headMetadata};
 const editId=newEditId(),shares=(history.shares??[]).map((s:any)=>({email:s.email.trim().toLowerCase(),role:s.role}));
 batch.rows.artifact_id_registry.push({id:history.pageId,owner:owner.userId,consumed:true});
 batch.rows.artifacts.push({id:history.pageId,token_id:owner.tokenId,user_id:owner.userId,creator_user_id:owner.userId,title:r.title,description:r.description,format:'html',source:html,meta,visibility:history.visibility,link_role:history.linkRole,
  ancestor_ids:[],edit_id:editId,access:'read',actor_user_id:r.actorUserId,actor_token_id:r.actorTokenId,version:r.page.version,sharing_revision:shares.length?1:0,policy_revision:0,created_at:iso(r.createdAt),updated_at:iso(r.createdAt)});
 batch.rows.artifact_versions.push({artifact_id:history.pageId,version:r.page.version,title:r.title,description:r.description,format:'html',source:html,meta,actor_user_id:r.actorUserId,actor_token_id:r.actorTokenId,created_at:iso(r.createdAt)});
 batch.rows.artifact_edits.push({artifact_id:history.pageId,edit_id:editId,splice_start:0,removed:'',inserted:html,span_start:0,span_end:html.length,actor_user_id:r.actorUserId,actor_token_id:r.actorTokenId,document_state:{version:r.page.version}});
 const active=new Set(canonicalizeHtmlPage(html,{previousHtml:html,ledger:r.ledger}).nodeIds);
 for(const sourceId of r.ledger.allocatedIds)batch.rows.artifact_source_ids.push({artifact_id:history.pageId,source_id:sourceId,provenance:'authored',first_version:r.page.version,retired_version:active.has(sourceId)?null:r.page.version});
 for(const p of [...r.queries,...r.mutations])batch.rows.html_backend_versions.push({backend_id:p.link.backendId,version:p.link.version,page_id:history.pageId,name:p.link.name,source:p.backend.source,type_defs:p.backend.typeDefs,compiled:p.backend.compiled,owner_id:owner.userId,secret_bindings:[]});
 for(const s of shares)batch.rows.artifact_shares.push({artifact_id:history.pageId,...s});

 // Assets: one file artifact each, owned like the page.
 for(const a of assets)fileArtifactRows(batch,{id:a.id as string,userId:owner.userId,tokenId:owner.tokenId,title:a.filename,format:'file',meta:{bytes:a.bytes,sha256:a.sha256,filename:a.filename,objectKey:a.objectKey,contentType:a.contentType},
  visibility:a.visibility as string,shares:a.shares as {email:string;role:string}[],editId:newEditId(),createdAt:r.createdAt,updatedAt:r.createdAt});

 await prepareDatasets(catalog,batch);
 for(const a of identity.avatarObjects??[])batch.objects.set(a.key,{bytes:Buffer.from(a.base64,'base64')});

 // Comments, comment images and members.
 const rows=relations.rows!;
 for(const c of rows.annotations)batch.rows.annotations.push({...c,artifact_id:history.pageId});
 for(const i of rows.images)batch.rows.comment_images.push({...i,artifact_id:history.pageId});
 for(const m of rows.members)batch.rows.relations.push({...m,subject_kind:'user',verb:'join',object_kind:'artifact',object_id:history.pageId});
 const memberRows=membership.relationRows??[];
 for(const m of memberRows)batch.rows.relations.push({...m});
 batch.pages.push({id:history.pageId,assets:assets.length,datasets:catalog.projection.datasets.map((d:any)=>d.targetId),comments:rows.annotations.length,members:rows.members.length+memberRows.length});
}

/** Bulk insert: one statement per table, columns taken from the rows. */
async function insertAll(client:pg.ClientBase,table:Table,rows:Row[],authSchema:string,count:()=>void,known:Map<string,Set<string>>){
 if(!rows.length)return 0;
 const target=table==='auth_user'?`"${authSchema}"."user"`:table,columns=[...new Set(rows.flatMap(r=>Object.keys(r)))];
 const unknown=columns.filter(c=>!known.get(table)?.has(c));if(unknown.length)fail('unknown_columns:'+table+':'+unknown.join(','));
 const list=columns.map(c=>`"${c}"`).join(',');
 const conflict=['users','auth_user','tokens','html_backend_versions'].includes(table)?' ON CONFLICT DO NOTHING':'';
 count();const result=await client.query(`INSERT INTO ${target} (${list}) SELECT ${list} FROM jsonb_populate_recordset(NULL::${target},$1::jsonb)${conflict}`,[JSON.stringify(rows)]);
 return result.rowCount??0;
}

const [configPath,...rest]=process.argv.slice(2),apply=rest.includes('--apply'),datasetMode=rest.includes('--datasets'),ids=rest.filter(a=>!a.startsWith('--'));
if(!configPath||!ids.length){console.error('usage: tsx scripts/import-pages.mts CONFIG.json [--datasets] [--apply] ID...');process.exit(64);}
const cfg=JSON.parse(await fs.readFile(configPath,'utf8')) as Config;
const env=JSON.parse(await fs.readFile(cfg.runtimeEnvironment,'utf8'));
const [codec,publicationModule]=await Promise.all([import(pathToFileURL(cfg.codec).href),import(pathToFileURL(cfg.publicationModule).href)]);
const publicationConfig=JSON.parse(await fs.readFile(cfg.publicationConfiguration,'utf8'));
const publication=publicationModule.createNativePipelinePublication(publicationConfig),authSchema=publicationConfig.shared.schemas.authSchema,appSchema=publicationConfig.shared.schemas.appSchema;
const started=Date.now(),batch:Batch={rows:Object.fromEntries(TABLES.map(t=>[t,[]])) as unknown as Record<Table,Row[]>,objects:new Map(),pages:[],datasetIds:new Set(),unverifiedDatasets:new Set()};

interface ImageReport{owner:{old:string;new:string};visibility:string;shares:number;files:{key:string;bytes:number;sha256:string}[]}
const imageReports:Record<string,ImageReport>={};
interface DatasetReport{title:string;owner:{old:string;new:string};visibility:string;version:number;versions:{imported:number;oldProdHistory:number};shares:number;audit:number;objects:{table:string;key:string;oldKey:string;derived:boolean;rows:number;oldRows:number}[];warnings:string[]}
const rowsOf=(bytes:Buffer)=>{const rows=JSON.parse(bytes.toString('utf8'));if(!Array.isArray(rows))fail('dataset_rows_not_array');return rows.length as number;};
const tablesOf=(meta:any):{table:string;key:string}[]=>meta?.catalog?(meta.catalog.tables??[]).filter((t:any)=>t.objectKey).map((t:any)=>({table:t.schema+'.'+t.name,key:t.objectKey})):meta?.objectKey?[{table:'public.rows',key:meta.objectKey}]:[];
const normalShares=(rows:{email:string;role:string}[])=>JSON.stringify(rows.map(s=>[s.email.trim().toLowerCase(),s.role]).sort());
/** Dataset-only mode: datasets from the config's shared catalog (already mapped to new-prod ids), each checked against old prod as it is now,
 * read-only, so a dataset that changed since the catalog was exported is refused rather than imported stale. Row building is prepareDatasets. */
async function collectDatasets(client:pg.Client,ids:string[],skipped:Record<string,string>,failed:Record<string,string>,reports:Record<string,DatasetReport>){
 const catalog=publicationConfig.shared.catalog,p=catalog.projection,users:Record<string,string>=p.identities.users,tokens:Record<string,string>=p.identities.tokens,old=cfg.oldSchema??'afbin_prod_app';
 if(!/^[a-z_][a-z0-9_]*$/.test(old))fail('old_schema');
 count();const existing=new Set((await client.query<{id:string}>('SELECT id FROM artifacts WHERE id=ANY($1::text[])',[ids])).rows.map(r=>r.id));
 // Old prod, read-only: heads, shares and version counts as they are now.
 count();await client.query('BEGIN READ ONLY');
 let heads:any[],shares:any[],versions:any[];
 try{
  count();heads=(await client.query(`SELECT id,format,version,user_id,token_id,creator_user_id,edit_id,visibility,link_role,created_at,updated_at,deleted_at,title,meta FROM ${old}.artifacts WHERE id=ANY($1::text[])`,[ids])).rows;
  count();shares=(await client.query(`SELECT artifact_id,email,role FROM ${old}.artifact_shares WHERE artifact_id=ANY($1::text[])`,[ids])).rows;
  count();versions=(await client.query(`SELECT artifact_id id,count(*)::int n FROM ${old}.artifact_versions WHERE artifact_id=ANY($1::text[]) GROUP BY 1`,[ids])).rows;
 }finally{count();await client.query('COMMIT');}
 count();const newUsers=new Set((await client.query<{id:string}>('SELECT id FROM users WHERE id=ANY($1::text[])',[heads.map(h=>users[h.user_id]).filter(Boolean)])).rows.map(r=>r.id));
 const oldObjects=createNativeS3ObjectSink({...parseS3Url(env.S3_URL),prefix:cfg.oldS3Prefix??'artifacts'});
 const imageTokens=heads.filter(h=>h.format==='image').map(h=>tokens[h.token_id]).filter(Boolean);
 count();const newTokens=new Set((await client.query<{id:string}>('SELECT id FROM tokens WHERE id=ANY($1::text[])',[imageTokens])).rows.map(r=>r.id));
 for(const id of ids){
  if(existing.has(id)){skipped[id]='exists';continue;}
  const h=heads.find(x=>x.id===id),d=p.datasets.find((x:any)=>x.targetId===id);
  if(!h){failed[id]='not_on_old_prod';continue;}
  if(h.format==='image'){
   // An image is one stored object (plus an optional small rendition); old prod's row is the source, with owner and token mapped like the catalog's.
   const owner=users[h.user_id],token=tokens[h.token_id],m=h.meta??{};
   if(!owner||!newUsers.has(owner)){failed[id]='owner_unmapped:'+h.user_id;continue;}
   if(!token||!newTokens.has(token)){failed[id]='token_unmapped:'+h.token_id;continue;}
   if(h.deleted_at||h.version!==1||(h.creator_user_id&&h.creator_user_id!==h.user_id)){failed[id]='image_shape:'+JSON.stringify({deleted:!!h.deleted_at,version:h.version,creator:h.creator_user_id});continue;}
   try{
    const own:Batch={rows:Object.fromEntries(TABLES.map(t=>[t,[]])) as unknown as Record<Table,Row[]>,objects:new Map(),pages:[],datasetIds:new Set(),unverifiedDatasets:new Set()},files:ImageReport['files']=[];
    for(const key of [m.objectKey,m.smallObjectKey].filter(Boolean) as string[]){
     const bytes=await oldObjects.get(key);
     // Stored image objects are content-addressed by their own bytes (meta.sha256 and meta.bytes describe the original upload).
     if('image/'+sha(bytes).slice(0,32)!==key)fail('image_digest:'+key);
     own.objects.set(key,{bytes,contentType:m.contentType});files.push({key,bytes:bytes.length,sha256:sha(bytes)});
    }
    fileArtifactRows(own,{id,userId:owner,tokenId:token,title:h.title,format:'image',meta:m,visibility:h.visibility,shares:shares.filter(s=>s.artifact_id===id),editId:h.edit_id,createdAt:h.created_at,updatedAt:h.updated_at});
    for(const t of TABLES)batch.rows[t].push(...own.rows[t]);for(const [k,o] of own.objects)batch.objects.set(k,o);
    imageReports[id]={owner:{old:h.user_id,new:owner},visibility:h.visibility,shares:shares.filter(s=>s.artifact_id===id).length,files};
   }catch(error){failed[id]=(error as Error).message;}
   continue;
  }
  if(!d){failed[id]='not_in_catalog';continue;}
  const a=d.authority,v=d.versions.find((x:any)=>x.version===d.currentVersion),owner=users[h.user_id];
  if(!owner||!newUsers.has(owner)){failed[id]='owner_unmapped:'+h.user_id;continue;}
  const drift=Object.entries({format:h.format!=='dataset',deleted:!!h.deleted_at,version:h.version!==d.currentVersion,edit:h.edit_id!==a.editId,updated:new Date(h.updated_at).getTime()!==new Date(a.updatedAt).getTime(),
   visibility:h.visibility!==a.visibility,linkRole:(h.link_role??'viewer')!==a.linkRole,owner:owner!==a.userId,token:(tokens[h.token_id]??null)!==a.tokenId,
   shares:normalShares(shares.filter(s=>s.artifact_id===id))!==normalShares(a.shares)}).filter(([,bad])=>bad).map(([k])=>k);
  if(drift.length){failed[id]='changed_since_catalog:'+drift.join(',');continue;}
  const own:Batch={rows:Object.fromEntries(TABLES.map(t=>[t,[]])) as unknown as Record<Table,Row[]>,objects:new Map(),pages:[],datasetIds:new Set(),unverifiedDatasets:new Set()};
  try{await prepareDatasets(catalog,own,new Set([id]));}catch(error){failed[id]=(error as Error).message;continue;}
  // Row counts: each table's object as imported against old prod's current object for that table.
  const oldTables=tablesOf(h.meta),objects:DatasetReport['objects']=[];let bad='';
  for(const t of tablesOf(v.meta)){
   const o=oldTables.find(x=>x.table===t.table);if(!o){bad='table_missing_on_old_prod:'+t.table;break;}
   const derived=t.key!==o.key;
   if(derived&&!(p.typedUserRemaps??[]).some((r:any)=>r.sourceId===id&&r.sourceObjectKey===o.key&&r.targetKey===t.key)){bad='object_changed_since_catalog:'+t.table;break;}
   const rows=rowsOf(own.objects.get(t.key)!.bytes),oldRows=rowsOf(await oldObjects.get(o.key));
   if(rows!==oldRows){bad='row_count:'+t.table+':'+rows+'!='+oldRows;break;}
   objects.push({table:t.table,key:t.key,oldKey:o.key,derived,rows,oldRows});
  }
  if(bad){failed[id]=bad;continue;}
  for(const t of TABLES)batch.rows[t].push(...own.rows[t]);for(const [k,o] of own.objects)batch.objects.set(k,o);
  for(const x of own.datasetIds)batch.datasetIds.add(x);for(const x of own.unverifiedDatasets)batch.unverifiedDatasets.add(x);
  const warnings=[];
  if((p.externalConnections??[]).some((c:any)=>c.datasetSourceId===id))warnings.push('connection_secret_not_migrated');
  reports[id]={title:v.title,owner:{old:h.user_id,new:owner},visibility:a.visibility,version:d.currentVersion,versions:{imported:d.versions.length,oldProdHistory:versions.find(x=>x.id===id)?.n??0},
   shares:a.shares.length,audit:d.policyAudit.length,objects,warnings};
 }
}

// Database through an SSH tunnel, as the earlier importer did; with a fixed query count the distance no longer matters.
let ssh:ReturnType<typeof spawn>|undefined,client:pg.Client|undefined,queries=0;
const count=()=>{queries++;};
try{
 const url=new URL(env.DATABASE_URL),port=cfg.port??53371;
 ssh=spawn('ssh',['-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=15','-i',process.env.HOME+'/.ssh/aws_login','-N','-L',`127.0.0.1:${port}:${url.hostname}:${url.port||5432}`,'ubuntu@artifactbin.dev'],{stdio:['ignore','ignore','inherit']});
 for(let n=0;;n++){const ok=await new Promise<boolean>(r=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();r(true);});s.once('error',()=>{s.destroy();r(false);});});if(ok)break;if(n>100)fail('tunnel');await new Promise(r=>setTimeout(r,100));}
 class Tunnel extends net.Socket{connect(_p:any,_h:any,...more:any[]):any{return super.connect(port,'127.0.0.1',...more as []);}}
 url.searchParams.set('options','-c search_path='+appSchema);
 client=new pg.Client({connectionString:url.toString(),stream:()=>new Tunnel()});await client.connect();

 const allDatasets=new Set<string>(),skipped:Record<string,string>={},failed:Record<string,string>={},datasets:Record<string,DatasetReport>={};
 if(datasetMode){await collectDatasets(client,ids,skipped,failed,datasets);if(!batch.rows.artifacts.length)fail('nothing_to_import:'+JSON.stringify({skipped,failed}));}
 else{
 // Query 1: which pages and datasets already exist. Existing pages are refused; existing datasets are reused.
 count();const existing=(await client.query<{id:string}>('SELECT id FROM artifacts WHERE id=ANY($1::text[])',[ids])).rows;
 if(existing.length)fail('pages_exist:'+existing.map(r=>r.id).join(','));
 // Each page builds into its own rows first, so a page that cannot be prepared is skipped whole.
 for(const id of ids){
  const own:Batch={rows:Object.fromEntries(TABLES.map(t=>[t,[]])) as unknown as Record<Table,Row[]>,objects:new Map(),pages:[],datasetIds:new Set(batch.datasetIds),unverifiedDatasets:new Set()};
  try{await preparePage(cfg,id,own,codec,publication,publicationConfig);}catch(error){skipped[id]=(error as Error).message;continue;}
  for(const t of TABLES)batch.rows[t].push(...own.rows[t]);for(const [k,v] of own.objects)batch.objects.set(k,v);batch.pages.push(...own.pages);
  for(const d of own.datasetIds)batch.datasetIds.add(d);for(const d of own.unverifiedDatasets)batch.unverifiedDatasets.add(d);
 }
 if(!batch.pages.length)fail('nothing_to_import:'+JSON.stringify(skipped));
 }
 count();for(const r of (await client.query<{id:string}>('SELECT id FROM artifacts WHERE id=ANY($1::text[])',[[...batch.datasetIds]])).rows)allDatasets.add(r.id);
 // Drop datasets that already exist (another page imported them earlier).
 if(allDatasets.size){for(const t of ['artifact_id_registry','artifacts','artifact_versions','artifact_shares','artifact_edits'] as const)batch.rows[t]=batch.rows[t].filter(r=>!allDatasets.has(String(r.id??r.artifact_id)));batch.rows.dataset_policy_audit=batch.rows.dataset_policy_audit.filter(r=>!allDatasets.has(String(r.dataset_id)));}

 // People and tokens are shared by every page in the batch: keep one row per id.
 // Tokens created after the identity plan, supplied by the config as disabled provenance rows.
 if(!datasetMode)batch.rows.tokens.push(...(cfg.extraTokens??[]));
 for(const t of ['users','auth_user','tokens'] as const)batch.rows[t]=[...new Map(batch.rows[t].map(r=>[String(r.id),r])).values()];
 // Query 3: the columns of every table written, so a misnamed field fails before anything is written.
 count();const known=new Map<string,Set<string>>();for(const r of (await client.query<{t:string;c:string}>("SELECT CASE WHEN table_schema=$2 THEN 'auth_user' ELSE table_name END t,column_name c FROM information_schema.columns WHERE (table_schema=$1 AND table_name=ANY($3::text[])) OR (table_schema=$2 AND table_name='user')",[appSchema,authSchema,TABLES.filter(t=>t!=='auth_user')])).rows)known.set(r.t,(known.get(r.t)??new Set()).add(r.c));
 const unknownColumns=Object.fromEntries(TABLES.map(t=>[t,[...new Set(batch.rows[t].flatMap(r=>Object.keys(r)))].filter(c=>!known.get(t)?.has(c))]).filter(([,c])=>c.length));
 const summary={skipped,...(datasetMode?{failed,datasets,images:imageReports}:{}),unknownColumns,unverifiedDatasets:[...batch.unverifiedDatasets],pages:batch.pages,rows:Object.fromEntries(TABLES.map(t=>[t,batch.rows[t].length])),files:batch.objects.size,fileBytes:[...batch.objects.values()].reduce((n,o)=>n+o.bytes.length,0),existingDatasetsReused:[...allDatasets]};
 if(!apply){console.log(JSON.stringify({mode:'dry-run',...summary,queries,seconds:Math.round((Date.now()-started)/1000)},null,1));process.exitCode=0;}
 else{
  // Files first, in parallel; conditional puts make reruns safe.
  const sink=createNativeS3ObjectSink(parseS3Url(env.S3_URL)),pending=[...batch.objects.entries()];let s3=0;
  await Promise.all(Array.from({length:16},async()=>{for(let next=pending.shift();next;next=pending.shift()){s3++;await sink.putIfAbsent(next[0],next[1].bytes,next[1].contentType);}}));
  count();await client.query('BEGIN');
  const written:Record<string,number>={};
  try{
   for(const t of TABLES)written[t]=await insertAll(client,t,batch.rows[t],authSchema,count,known);
   // Read back once: every page with its row counts.
   count();const back=(await client.query<{id:string;versions:number;edits:number;source_ids:number;comments:number}>(`SELECT a.id,
     (SELECT count(*) FROM artifact_versions v WHERE v.artifact_id=a.id)::int versions,(SELECT count(*) FROM artifact_edits e WHERE e.artifact_id=a.id)::int edits,
     (SELECT count(*) FROM artifact_source_ids s WHERE s.artifact_id=a.id)::int source_ids,(SELECT count(*) FROM annotations n WHERE n.artifact_id=a.id)::int comments
     FROM artifacts a WHERE a.id=ANY($1::text[]) AND a.format='html' AND a.deleted_at IS NULL`,[batch.pages.map(p=>p.id)])).rows;
   for(const p of batch.pages){const b=back.find(x=>x.id===p.id);if(!b||b.versions!==1||b.edits!==1||b.comments!==p.comments)fail('readback:'+p.id+':'+JSON.stringify(b));}
   // Images: present with the mapped owner and visibility.
   const images=batch.rows.artifacts.filter(r=>r.format==='image');
   if(images.length){count();const got=(await client.query<{id:string;user_id:string;visibility:string}>(`SELECT id,user_id,visibility FROM artifacts WHERE id=ANY($1::text[]) AND format='image' AND deleted_at IS NULL`,[images.map(r=>r.id)])).rows;
    for(const r of images){const b=got.find(x=>x.id===r.id);if(!b||b.user_id!==r.user_id||b.visibility!==r.visibility)fail('readback:'+r.id+':'+JSON.stringify(b));}}
   // Datasets: owner, visibility and every row count as built.
   const imported=batch.rows.artifacts.filter(r=>r.format==='dataset');
   if(imported.length){
    count();const got=(await client.query<{id:string;user_id:string;visibility:string;versions:number;shares:number;audit:number;edits:number}>(`SELECT a.id,a.user_id,a.visibility,
      (SELECT count(*) FROM artifact_versions v WHERE v.artifact_id=a.id)::int versions,(SELECT count(*) FROM artifact_shares s WHERE s.artifact_id=a.id)::int shares,
      (SELECT count(*) FROM dataset_policy_audit p WHERE p.dataset_id=a.id)::int audit,(SELECT count(*) FROM artifact_edits e WHERE e.artifact_id=a.id)::int edits
      FROM artifacts a WHERE a.id=ANY($1::text[]) AND a.format='dataset' AND a.deleted_at IS NULL`,[imported.map(r=>r.id)])).rows;
    const n=(t:Table,id:string,k='artifact_id')=>batch.rows[t].filter(r=>r[k]===id).length;
    for(const r of imported){const id=String(r.id),b=got.find(x=>x.id===id);
     if(!b||b.user_id!==r.user_id||b.visibility!==r.visibility||b.versions!==n('artifact_versions',id)||b.shares!==n('artifact_shares',id)||b.audit!==n('dataset_policy_audit',id,'dataset_id')||b.edits!==1)fail('readback:'+id+':'+JSON.stringify(b));}
   }
   count();await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  // Dataset objects as stored now: each one read back from object storage with the same row count as old prod.
  const stored:Record<string,string>={};
  for(const [id,report] of Object.entries(datasets))for(const o of report.objects){const rows=rowsOf(await sink.get(o.key));stored[id+' '+o.table]=rows===o.oldRows?'ok':'row_count:'+rows+'!='+o.oldRows;}
  for(const [id,report] of Object.entries(imageReports))for(const f of report.files){const got=await sink.get(f.key);stored[id+' '+f.key]=got.length===f.bytes&&sha(got)===f.sha256?'ok':'bytes_differ';}
  console.log(JSON.stringify({mode:'applied',...summary,written,storedObjects:stored,queries,s3Uploads:s3,seconds:Math.round((Date.now()-started)/1000)},null,1));
  if(Object.values(stored).some(v=>v!=='ok'))process.exitCode=1;
 }
}catch(e){console.error((e as Error).message,(e as Error).stack?.split('\n').slice(1,4).join('\n'));process.exitCode=1;}
finally{await client?.end().catch(()=>{});ssh?.kill('SIGTERM');}
