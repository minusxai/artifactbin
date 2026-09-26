import {renderLocalImage} from './local-image-runtime';
import type {LocalImageRenderer} from './local-image-options';
import {localIdentities} from './identities';
import {basename,extname,join,relative,resolve} from 'node:path';
import {stat} from 'node:fs/promises';
import {stringify} from 'yaml';
import {CliError} from './errors';
import {atomicWrite,digest,localBackup,readOptional} from './files';
import {confinedPath} from './journal';
import {resolveReference} from './reference';
import {parseResourceFile,readResourceSource} from './resource-file';
import {localQuery} from './local-query';
import {rowsCsv} from './tabular';
import {parseCsv} from '../../app/lib/data-ingest/csv';
import {coerceRows} from '../../app/lib/data-ingest/coerce';
import type {HttpClient} from './http';
import {datasetFileRows,isDatasetFile} from './dataset-file';
import type {Workspace,Snapshot} from './workspace';

/** Published rendering stays on its host; local images use the lazy preview/browser runtime. */
interface Renderer {
 /** The shareable published view; derivable offline, which is why open never needs the network. */
 viewUrl(id:string):string;
 /** `version` photographs that ARCHIVED version's page instead of the head; the server runs its own ACL on it. */
 image(id:string,options:{format:'png'|'jpg';page?:number;og?:boolean;refresh?:boolean;version?:number}):Promise<{bytes:Buffer;contentType:string}>;
 /** The offline file: one self-contained `.html` that opens, edits and comments without a connection (never the served `/raw` page). */
 html(id:string,version?:number):Promise<{bytes:Buffer;contentType:string}>;
}
export function serverRenderer(server:string,client?:HttpClient):Renderer{
 const rendering=():HttpClient=>{if(!client)throw new CliError('renderer_unavailable','Rendering runs on the server and needs credentials for it.',RENDERER_FIX);return client;};
 return {
  viewUrl:id=>`${server}/a/${id}`,
  image:(id,options)=>rendering().view(`/a/${id}/export?format=${options.format}${options.version!==undefined?`&version=${options.version}`:''}${options.page!==undefined?`&slide=${options.page}`:''}${options.og?'&mode=card':''}${options.refresh?'&refresh=1':''}`),
  html:(id,version)=>rendering().view(`/a/${id}/download${version!==undefined?`?version=${version}`:''}`),
 };
}

const RENDERED=['png','jpg','html'] as const;
const RENDERER_FIX='push the draft, or export csv/json/yaml/original';
const EXTENSIONS:Record<string,string>={png:'png',jpg:'jpg',html:'html',csv:'csv',json:'json',yaml:'yaml'};
const rendered=(format:string):format is typeof RENDERED[number]=>RENDERED.includes(format as never);

interface ExportOptions {
 localImage?:LocalImageRenderer;type?:string;format?:string;output?:string;name?:string;page?:number;og?:boolean;refresh?:boolean;force?:boolean;dryRun?:boolean;
 server:string;/** Verified other addresses of `server`. */aliases?:readonly string[];client?:HttpClient;emit:(value:unknown)=>void;bytes?:(value:Uint8Array)=>void;
}
interface ExportTarget {ref:string;format:string;id?:string;path?:string;version?:number;render:boolean}
interface ExportResult {path?:string;bytes:Buffer;format:string}

/**
 * Export the selected resources. Returns false when a target still needs an authenticated
 * client, so the offline call site falls through without a local conversion touching the network.
 */
export async function exportResources(workspace:Workspace,refs:string[],options:ExportOptions):Promise<boolean>{
 const stdoutBytes=options.bytes??(value=>process.stdout.write(value));
 const format=selectFormat(refs,options);
 if(rendered(format)&&options.name!==undefined)throw new CliError('unsupported_format',`--name selects data, not a ${format} rendering.`,'Export csv, json or yaml with --name, or drop --name.');
 if((options.og||options.refresh)&&!['png','jpg'].includes(format))throw new CliError('unsupported_format','--og and --refresh require an image export.','Use --format png or jpg.');
 if(options.og&&options.page!==undefined)throw new CliError('invalid_flags','--og cannot be combined with --page.');
 if(options.page!==undefined&&format!=='png'&&format!=='jpg')throw new CliError('unsupported_format',`--page selects one slide of an image export, not ${format}.`,'Use --format png or jpg with --page, or export the whole resource.');
 const localFiles=['png','jpg'].includes(format)?await localIdentities(workspace):{};
 const targets:ExportTarget[]=[];
 for(const input of refs){
  const ref=await resolveReference(input,{root:workspace.root,cwd:workspace.cwd,server:options.server,aliases:[...options.aliases??[]]});
  if(rendered(format)){
   /*
    * `<id>@N` RENDERS. The document can be SERVED at an older version now
    * (`/a/<id>/export?version=N`, `/a/<id>/download?version=N`), so the renderer
    * photographs that page — or packs that version's offline file — exactly as it
    * does the head, which is what an agent checking the page it just changed was
    * missing.
    *
    * A LOCAL PATH still has no history: `report.jsx@2` names bytes nobody
    * stored, and the tracked file on disk IS the head. So a version pins the
    * target to the published id and never to the local render.
    */
   const atVersion=ref.version!==undefined;
   const path=ref.kind==='path'?ref.path:atVersion||/^https?:\/\//.test(input)?undefined:localFiles[ref.id];
   if(atVersion&&path!==undefined)throw new CliError('unsupported_version_export',`${input} names a local file and a version.`,`Export the published id at that version, e.g. afbin export <id>@${ref.version} --format ${format}, or the file as it stands.`);
   targets.push({ref:input,format,render:true,...(ref.version!==undefined?{version:ref.version}:{}),...(path!==undefined?{path,...(format==='html'?{id:publishedHead(workspace,path)}:{})}:{id:ref.kind==='id'?ref.id:undefined})});
  }else targets.push({ref:input,format,render:false,...(ref.kind==='id'?{id:ref.id,...(ref.version?{version:ref.version}:{})}:{path:ref.path,...(ref.version?{version:ref.version}:{})})});
 }
 const destinations=await plan(workspace,targets,options);
 // A dry run reports destinations and the capability each target needs; it renders nothing,
 // writes nothing and never sets up credentials.
 if(options.dryRun){
  options.emit({dry_run:true,operations:targets.map((target,index)=>({ref:target.ref,format:target.format,...(destinations[index]?{path:destinations[index]}:{output:'-'}),
   requires:target.render?(target.path!==undefined&&target.format!=='html'?'local_rendering':'server_rendering'):'local_conversion',status:'would_write'}))});
  return true;
 }
 if(targets.some(target=>target.id!==undefined&&!options.client))return false;
 const results:ExportResult[]=[];
 for(const [index,target] of targets.entries()){
  const bytes=target.render
   ?await renderTarget(workspace,target,options)
   :target.path!==undefined?await convertLocal(workspace,target,options):await convertRemote(target,options);
  results.push({...(destinations[index]!==undefined?{path:destinations[index]}:{}),bytes,format:target.format});
 }
 const operations=[];
 for(const result of results){
  if(result.path===undefined){stdoutBytes(result.bytes);operations.push({format:result.format,output:'-',status:'written'});continue;}
  operations.push({path:result.path,format:result.format,status:'written',...await write(workspace,result.path,result.bytes,!!options.force)});
 }
 // Exported bytes own stdout alone; the envelope would corrupt them.
 if(results.some(result=>result.path===undefined))return true;
 options.emit({operations});
 return true;
}

/** `--format` wins; otherwise a recognized output extension names it. A disagreement is an error. */
function selectFormat(refs:string[],options:ExportOptions):string{
 const output=options.output&&options.output!=='-'?extname(options.output).toLowerCase().slice(1):'';
 const inferred=output==='yml'?'yaml':output==='jpeg'?'jpg':Object.hasOwn(EXTENSIONS,output)?output:undefined;
 if(options.format&&inferred&&inferred!==options.format&&refs.length===1)throw new CliError('invalid_format',`--format ${options.format} and the output filename disagree.`,`Name the file ${EXTENSIONS[options.format]}, or export --format ${inferred}.`);
 if(options.format)return options.format;
 if(inferred&&refs.length===1)return inferred;
 throw new CliError('invalid_format','The export representation is not determined.','Add --format png|jpg|html|csv|json|yaml|original, or name an --output file with a known extension.');
}

/** Rendering photographs a published head, so a local file must prove it still is that head. */
function publishedHead(workspace:Workspace,path:string):string{
 const tracked=workspace.tracking?.files[path];
 if(!tracked)throw new CliError('renderer_unavailable',`${path} is not tracked as a published artifact, so there is no head to render.`,RENDERER_FIX);
 return tracked.id;
}
async function unchangedHead(workspace:Workspace,path:string):Promise<void>{
 // `file` is the sha256 of the local bytes last accepted, so the comparison needs no stored copy of them.
 const tracked=workspace.tracking!.files[path];
 const bytes=await readOptional(await confinedPath(workspace.root,path));
 if(!bytes||digest(bytes)!==tracked.file)throw new CliError('renderer_unavailable',`${path} differs from its observed head; drafts are never uploaded for rendering.`,RENDERER_FIX);
}

async function renderTarget(workspace:Workspace,target:ExportTarget,options:ExportOptions):Promise<Buffer>{
 if(target.path!==undefined&&(target.format==='png'||target.format==='jpg'))return (options.localImage??renderLocalImage)({cwd:workspace.root,home:workspace.home,path:target.path,server:options.server,format:target.format,page:options.page,og:options.og});
 const renderer=serverRenderer(options.server,options.client);
 const result=target.format==='html'
  ?await renderer.html(target.id!,target.version)
  :await renderer.image(target.id!,{format:target.format as 'png'|'jpg',og:options.og,refresh:options.refresh,...(options.page!==undefined?{page:options.page}:{}),...(target.version!==undefined?{version:target.version}:{})});
 return result.bytes;
}

async function convertLocal(workspace:Workspace,target:ExportTarget,options:ExportOptions):Promise<Buffer>{
 const path=target.path!;
 const bytes=await readOptional(await confinedPath(workspace.root,path));
 if(!bytes)throw new CliError('missing_file',`Missing ${path}.`);
 if(target.version!==undefined)throw new CliError('invalid_reference',`${target.ref} names a local file and a version.`,'Export the artifact id at that version, or the file as it stands.');
 let source=path,content=bytes;
 if(/\.ya?ml$/i.test(path)){
  const resource=parseResourceFile(bytes.toString());
  if(target.format==='yaml'&&options.name===undefined)return bytes;
  const captured=await readResourceSource(resource,path,workspace.root);
  if(!captured)throw new CliError('unsupported_format',`A ${resource.type} has no ${target.format} representation here.`,'Export --format yaml for its settings.');
  source=captured.path;content=Buffer.from(captured.bytes,'base64');
 }
 if(target.format==='original')return content;
 if(options.name!==undefined||/\.jsx$/i.test(source))return serialize(await namedRows(workspace,source,options),target.format);
 if(!isDatasetFile(source))throw new CliError('unsupported_format',`${path} has no ${target.format} representation.`,'Export --format original for its bytes, or select a named result with --name.');
 return serialize(datasetFileRows(source,content,path),target.format);
}

async function convertRemote(target:ExportTarget,options:ExportOptions):Promise<Buffer>{
 if(options.name!==undefined)throw new CliError('unsupported_format','A named result of a remote resource is a query, not an export.',`Run afbin query ${target.ref} --name <name> --format ${target.format} --output <path>.`);
 const client=options.client!;
 const head=await client.request<Snapshot>(`/artifacts/${target.id}`);
 const version=target.version??head.version;
 if(target.format==='yaml'&&head.format==='markup')throw new CliError('unsupported_format','A document exports its rendering or its original markup.','Use afbin pull for its editable YAML settings.');
 const content=await client.content(`/artifacts/${target.id}/content?version=${version}`);
 if(target.format==='original')return content.bytes;
 if(head.format!=='dataset')throw new CliError('unsupported_format',`A ${head.format} artifact has no ${target.format} representation.`,'Export --format original for its bytes, or png, jpg or html for a rendering.');
 return serialize(readRows(content.bytes,'.json',target.ref),target.format);
}

/** Named tables and declared query results come from the same local engines `query` runs. */
async function namedRows(workspace:Workspace,path:string,options:ExportOptions):Promise<Record<string,unknown>[]>{
 const flags:Record<string,string|boolean|string[]>={limit:'100'};
 if(options.name!==undefined)flags.name=options.name;
 const result=await localQuery(workspace,{command:'query',positionals:[path],flags},undefined,options.server);
 const rows=(result as {results?:{rows?:Record<string,unknown>[]}[]}|null)?.results?.[0]?.rows;
 if(!rows)throw new CliError('unsupported_format',`${path} produced no exportable result.`,'Run afbin query to see the available names, or export --format original.');
 return rows;
}

function readRows(bytes:Buffer,extension:string,label:string):Record<string,unknown>[]{
 if(extension==='.csv'){const csv=parseCsv(bytes.toString());return coerceRows(csv.headers,csv.rows) as Record<string,unknown>[];}
 let rows:unknown;try{rows=JSON.parse(bytes.toString());}catch{throw new CliError('invalid_dataset',`${label} is not valid JSON.`);}
 if(!Array.isArray(rows)||!rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row)))throw new CliError('invalid_dataset',`${label} must contain an array of row objects.`);
 return rows as Record<string,unknown>[];
}
function serialize(rows:Record<string,unknown>[],format:string):Buffer{
 if(format==='csv')return Buffer.from(rowsCsv(rows));
 if(format==='yaml')return Buffer.from(stringify(rows,{lineWidth:0}));
 return Buffer.from(JSON.stringify(rows,null,2)+'\n');
}

/** Destinations are decided for every target before anything is rendered or written. */
async function plan(workspace:Workspace,targets:ExportTarget[],options:ExportOptions):Promise<(string|undefined)[]>{
 for(const target of targets)if(target.format==='html'&&target.path!==undefined)await unchangedHead(workspace,target.path);
 if(options.output==='-')return targets.map(()=>undefined);
 const outputPath=options.output?await confinedPath(workspace.root,resolve(workspace.cwd,options.output)).catch(error=>{
  // `--output /tmp/x.png` from a workspace elsewhere: an agent tried it in three tasks and got a generic failure.
  if(error instanceof Error&&/outside the workspace/.test(error.message))throw new CliError('outside_workspace',`${options.output} is outside the workspace.`);
  throw error;
 }):undefined;
 const outputStat=outputPath?await stat(outputPath).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}):null;
 if(targets.length>1&&outputPath&&!outputStat?.isDirectory())throw new CliError('ambiguous_output','Several exports require an --output directory.','Export one resource at a time, or create the directory.');
 const directory=outputStat?.isDirectory()?relative(workspace.root,outputPath!):undefined;
 const taken=new Set<string>();const destinations:(string|undefined)[]=[];
 for(const target of targets){
  if(outputPath&&!directory){destinations.push(relative(workspace.root,outputPath));taken.add(destinations.at(-1)!);continue;}
  const base=target.path!==undefined?basename(target.path,extname(target.path)):target.id!;
  const extension=target.format==='original'?originalExtension(target)??'.bin':`.${EXTENSIONS[target.format]}`;
  let path=join(directory??'',`${base}${extension}`);
  for(let attempt=2;taken.has(path)||path===target.path;attempt++)path=join(directory??'',`${base}-${attempt}${extension}`);
  taken.add(path);destinations.push(path);
 }
 const sources=new Set([...targets.flatMap(target=>target.path===undefined?[]:[target.path]),...Object.values(await localIdentities(workspace))]);
 for(const destination of destinations){
  if(destination===undefined)continue;
  if(sources.has(destination))throw new CliError('output_exists',`${destination} is a source file.`,'Choose a different output file.');
  if(!options.force&&await readOptional(await confinedPath(workspace.root,destination)))throw new CliError('output_exists',`${destination} already exists.`,'Choose a free --output path, or use --force.');
 }
 return destinations;
}
function originalExtension(target:ExportTarget):string|undefined{
 return target.path!==undefined?extname(target.path)||undefined:undefined;
}

/** Exports never establish tracking, never replace a tracked source file, and never write state into the workspace. */
async function write(workspace:Workspace,path:string,bytes:Buffer,force:boolean):Promise<Record<string,unknown>>{
 if(workspace.tracking?.files[path])throw new CliError('output_exists',`${path} is a tracked source file.`,'Choose a destination outside the workspace tracking.');
 const destination=await confinedPath(workspace.root,path);
 const before=await readOptional(destination);
 if(before&&!force)throw new CliError('output_exists',`${path} already exists.`,'Choose a free --output path, or use --force to replace it after a recoverable backup.');
 if(!before){await atomicWrite(destination,bytes,{exclusive:true});return {};}
 // The replaced bytes are kept under the CLI's own state directory and reported absolutely.
 const backup=await localBackup(workspace.home,path,before);
 await atomicWrite(destination,bytes);
 return {backup};
}
