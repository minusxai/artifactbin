import {basename,dirname,extname,join,relative,resolve} from 'node:path';
import {stat} from 'node:fs/promises';
import {CliError} from './errors';
import {atomicWrite,readOptional} from './files';
import {confinedPath} from './journal';
import {resolveReference} from './reference';
import {parseDocument,writeDocument,identityFields,type DocumentMetadata} from './document';
import {parseResourceFile,writeResourceFile} from './resource-file';
import {snapshotDocument} from './local';
import {planDependencies} from './dependencies';
import {rowsCsv} from './tabular';
import type {HttpClient} from './http';
import type {Workspace,Snapshot} from './workspace';
import type {ArtifactResourceFile} from '@artifactbin/contracts';

/**
 * A fork is a NEW local draft, never a server copy: the source's write identity and its
 * invitations are removed, lineage is recorded once, and sharing restarts at private. The
 * first push sends `forked_from` on create; nothing here publishes or tracks anything.
 */
const strippedFields=[...identityFields,'shares','folder','link'] as const;
/** Folders have no content of their own and a Postgres dataset's secret stays bound to the original. */
const NOT_FORKABLE_FIX='Fork a document, dataset rows or a file; a folder names its children and a Postgres dataset keeps its bound secret.';

interface ForkOptions {type?:string;output?:string;dryRun?:boolean;server:string;client?:HttpClient}
interface ForkFile {path:string;bytes:Buffer}
interface ForkDraft {kind:'artifact'|'dataset'|'file';forkedFrom:string;base:string;extension:string;render:(paths:{draft:string;source?:string})=>Buffer;source?:{extension:string;bytes:Buffer};dependencies:string[]}

function forkMetadata(metadata:DocumentMetadata,forkedFrom:string):DocumentMetadata{
 const carried=Object.fromEntries(Object.entries(metadata).filter(([key])=>!strippedFields.includes(key as never)));
 return {...carried,forked_from:forkedFrom,visibility:'private'} as DocumentMetadata;
}

/**
 * Fork the selected sources into new local drafts. Returns `undefined` when a remote source
 * still needs an authenticated client, so the offline call site can fall through to the
 * authenticated one without a local source ever reaching the network.
 */
export async function forkResources(workspace:Workspace,refs:string[],options:ForkOptions):Promise<{dry_run?:true;operations:Record<string,unknown>[]}|undefined>{
 const resolved=[];
 for(const input of refs){
  const ref=await resolveReference(input,{root:workspace.root,cwd:workspace.cwd,server:options.server});
  if(ref.kind==='id'&&!options.client)return undefined;
  resolved.push({input,ref});
 }
 const outputPath=options.output?await confinedPath(workspace.root,resolve(workspace.cwd,options.output)):undefined;
 const outputStat=outputPath?await stat(outputPath).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}):null;
 if(refs.length>1&&!outputStat?.isDirectory())throw new CliError('invalid_output','Several fork sources require an existing --output directory.','Create the directory, or fork one source at a time.');
 const directory=outputStat?.isDirectory()?relative(workspace.root,outputPath!):undefined;
 const taken=new Set<string>(resolved.filter(entry=>entry.ref.kind==='path').map(entry=>(entry.ref as {path:string}).path));
 const files:ForkFile[]=[];const operations:Record<string,unknown>[]=[];
 for(const {input,ref} of resolved){
  const draft=ref.kind==='path'?await localDraft(workspace,ref.path,options.type):await remoteDraft(options.client!,ref.id,ref.version,options.type);
  const explicit=outputPath&&!directory?relative(workspace.root,outputPath):undefined;
  if(explicit&&extname(explicit).toLowerCase()!==draft.extension)throw new CliError('invalid_output',`A ${draft.kind} fork of ${input} is a ${draft.extension} file.`,`Choose an --output path ending in ${draft.extension}.`);
  const path=explicit??await freePath(workspace,directory,draft.base,draft.extension,taken);
  await reserve(workspace,path,taken,!!explicit);
  const sourcePath=draft.source?await freePath(workspace,directory??dirname(path),basename(path,draft.extension),draft.source.extension,taken):undefined;
  if(sourcePath)await reserve(workspace,sourcePath,taken,false);
  files.push({path,bytes:draft.render({draft:path,...(sourcePath?{source:sourcePath}:{})})});
  if(draft.source&&sourcePath)files.push({path:sourcePath,bytes:draft.source.bytes});
  operations.push({ref:input,path,type:draft.kind,forked_from:draft.forkedFrom,visibility:'private',shares:[],dependencies:draft.dependencies,...(sourcePath?{source:sourcePath}:{}),status:options.dryRun?'would_create':'created'});
 }
 if(options.dryRun)return {dry_run:true,operations};
 for(const file of files){
  const destination=await confinedPath(workspace.root,file.path);
  try{await atomicWrite(destination,file.bytes,{exclusive:true});}
  catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw existing(file.path);throw error;}
 }
 return {operations};
}

const existing=(path:string)=>new CliError('output_exists',`${path} already exists.`,'Choose a free --output path; fork never replaces a source or an existing draft.');

async function reserve(workspace:Workspace,path:string,taken:Set<string>,explicit:boolean):Promise<void>{
 if(taken.has(path))throw existing(path);
 if(explicit&&await readOptional(await confinedPath(workspace.root,path)))throw existing(path);
 taken.add(path);
}

/** A collision-checked suggestion; the source itself is never a candidate. */
async function freePath(workspace:Workspace,directory:string|undefined,base:string,extension:string,taken:Set<string>):Promise<string>{
 for(let attempt=1;;attempt++){
  const path=join(directory??'',`${base}-fork${attempt>1?`-${attempt}`:''}${extension}`);
  if(!taken.has(path)&&!await readOptional(await confinedPath(workspace.root,path)))return path;
  if(attempt>100)throw new CliError('output_exists',`No free destination beside ${base}${extension}.`,'Choose an explicit --output path.');
 }
}

function conflictingType(selected:string|undefined,actual:string,input:string):void{
 if(selected&&selected!==actual)throw new CliError('type_mismatch',`${input} is of type ${actual}, not ${selected}.`,'Remove --type, or name a source of that type.');
}

async function localDraft(workspace:Workspace,path:string,type:string|undefined):Promise<ForkDraft>{
 const bytes=await readOptional(await confinedPath(workspace.root,path));
 if(!bytes)throw new CliError('missing_file',`Missing ${path}.`);
 const extension=extname(path).toLowerCase();
 const tracked=workspace.tracking?.files[path];
 const base=basename(path,extname(path));
 if(extension==='.jsx'){
  const document=parseDocument(bytes.toString());
  conflictingType(type,'artifact',path);
  const id=identity(document.metadata.id??tracked?.id,path);
  const dependencies=(await planDependencies(document.body,path,workspace.root)).map(entry=>entry.path);
  return {kind:'artifact',forkedFrom:id,base,extension:'.jsx',dependencies,render:()=>Buffer.from(writeDocument({metadata:forkMetadata(document.metadata,id),body:document.body}))};
 }
 if(['.yaml','.yml'].includes(extension)){
  const resource=parseResourceFile(bytes.toString());
  if(resource.type==='folder')throw new CliError('not_forkable',`${path} is a folder.`,NOT_FORKABLE_FIX);
  conflictingType(type,resource.type,path);
  const id=identity(resource.id??tracked?.id,path);
  if(resource.type==='dataset'&&await connectedDataset(workspace,resource,path))throw new CliError('not_forkable',`${path} is a connected dataset.`,NOT_FORKABLE_FIX);
  // The typed source reference is kept verbatim: a fork reuses the same local bytes.
  return {kind:resource.type,forkedFrom:id,base,extension,dependencies:resource.source?[resource.source]:[],
   render:()=>Buffer.from(writeResourceFile({...forkMetadata(resource,id),type:resource.type,...(resource.source!==undefined?{source:resource.source}:{})} as ArtifactResourceFile))};
 }
 // Asset bytes carry no fence, so their draft is the typed YAML that names them.
 const format=tracked?.snapshot.format;
 const id=identity(tracked?.id,path);
 const kind=format==='dataset'?'dataset':'file';
 conflictingType(type,kind,path);
 const reference=relative(workspace.root,await confinedPath(workspace.root,path));
 return {kind,forkedFrom:id,base,extension:'.yaml',dependencies:[reference],
  render:({draft})=>Buffer.from(writeResourceFile({...forkMetadata({},id),type:kind,source:relativeSource(draft,reference)} as ArtifactResourceFile))};
}

function identity(id:string|undefined,path:string):string{
 if(!id)throw new CliError('identity_required',`${path} has no artifact id to record as lineage.`,'Publish it with afbin push first, or copy the file yourself to start an unrelated draft.');
 return id;
}

/** A definition holding a <Connection> is a live Postgres source whose secret stays bound to the original. */
async function connectedDataset(workspace:Workspace,resource:ArtifactResourceFile,path:string):Promise<boolean>{
 if(resource.type!=='dataset'||!resource.source||!/\.jsx$/i.test(resource.source))return false;
 const definition=await readOptional(await confinedPath(workspace.root,resolve(workspace.root,dirname(path),resource.source)));
 return !!definition&&/<Connection[\s/>]/.test(definition.toString());
}

/** Remote sources take the pull retrieval path: one snapshot read, plus content for the data tiers. */
async function remoteDraft(client:HttpClient,id:string,version:number|undefined,type:string|undefined):Promise<ForkDraft>{
 const head=await client.request<Snapshot>(`/artifacts/${id}`);
 if(head.id!==id||!Number.isSafeInteger(head.version))throw new CliError('invalid_response','The server did not return a complete artifact snapshot.');
 const snapshot=version&&version!==head.version?{...head,...await client.request<Record<string,unknown>>(`/artifacts/${id}/versions/${version}`),id:head.id,version} as Snapshot:head;
 if(snapshot.format==='folder')throw new CliError('not_forkable',`${id} is a folder.`,NOT_FORKABLE_FIX);
 if(snapshot.format==='dataset'&&String((snapshot.catalog as {kind?:unknown}|undefined)?.kind??snapshot.dataset_kind??'stored')==='postgres')throw new CliError('not_forkable',`${id} is a connected dataset.`,NOT_FORKABLE_FIX);
 if(snapshot.format==='markup'){
  conflictingType(type,'artifact',id);
  const document=snapshotDocument(snapshot);
  return {kind:'artifact',forkedFrom:id,base:id,extension:'.jsx',dependencies:[],render:()=>Buffer.from(writeDocument({metadata:forkMetadata(document.metadata,id),body:document.body}))};
 }
 const content=await client.content(`/artifacts/${id}/content?version=${snapshot.version}`);
 const kind=snapshot.format==='dataset'?'dataset':'file';
 conflictingType(type,kind,id);
 const metadata=forkMetadata(snapshotDocument(snapshot).metadata,id);
 if(kind==='dataset'){
  let rows:unknown;try{rows=JSON.parse(content.bytes.toString());}catch{throw new CliError('invalid_response','Dataset content is not JSON.');}
  if(!Array.isArray(rows)||!rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row)))throw new CliError('invalid_response','Dataset content must contain row objects.');
  return {kind,forkedFrom:id,base:id,extension:'.yaml',dependencies:[],source:{extension:'.csv',bytes:Buffer.from(rowsCsv(rows as Record<string,unknown>[]))},
   render:({draft,source})=>Buffer.from(writeResourceFile({...metadata,type:'dataset',source:relativeSource(draft,source!)} as ArtifactResourceFile))};
 }
 return {kind,forkedFrom:id,base:id,extension:'.yaml',dependencies:[],source:{extension:assetExtension(snapshot,content.contentType),bytes:content.bytes},
  render:({draft,source})=>Buffer.from(writeResourceFile({...metadata,type:'file',source:relativeSource(draft,source!)} as ArtifactResourceFile))};
}

/** Resource `source` is read relative to the YAML that names it. */
function relativeSource(draft:string,source:string):string{
 const value=relative(dirname(draft),source);
 return value.startsWith('.')?value:`./${value}`;
}

function assetExtension(snapshot:Snapshot,contentType:string):string{
 if(typeof snapshot.filename==='string'&&extname(snapshot.filename))return extname(snapshot.filename).replace(/[^.a-zA-Z0-9]/g,'')||'.bin';
 return ({'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','image/svg+xml':'.svg','application/pdf':'.pdf'} as Record<string,string>)[contentType.split(';')[0].trim()]??'.bin';
}
