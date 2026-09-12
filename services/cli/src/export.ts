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
import type {Workspace,Snapshot} from './workspace';

/**
 * THE RENDERING SEAM. `png`, `jpg` and `html` are pictures of a published page, and the CLI
 * ships neither a headless browser nor the document runtime, so today one implementation
 * exists and it asks the server. Export and open both address rendering only through this
 * interface, so a local renderer becomes a second implementation rather than a command change.
 */
interface Renderer {
 /** The shareable published view; derivable offline, which is why open never needs the network. */
 viewUrl(id:string):string;
 image(id:string,options:{format:'png'|'jpg';page?:number}):Promise<{bytes:Buffer;contentType:string}>;
 html(id:string):Promise<{bytes:Buffer;contentType:string}>;
}
export function serverRenderer(server:string,client?:HttpClient):Renderer{
 const rendering=():HttpClient=>{if(!client)throw new CliError('renderer_unavailable','Rendering runs on the server and needs credentials for it.',RENDERER_FIX);return client;};
 return {
  viewUrl:id=>`${server}/a/${id}`,
  image:(id,options)=>rendering().view(`/a/${id}/export?format=${options.format}${options.page!==undefined?`&slide=${options.page}`:''}`),
  html:id=>rendering().view(`/a/${id}/raw`),
 };
}

const RENDERED=['png','jpg','html'] as const;
const RENDERER_FIX='push the draft, or export csv/json/yaml/original';
const EXTENSIONS:Record<string,string>={png:'png',jpg:'jpg',html:'html',csv:'csv',json:'json',yaml:'yaml'};
const rendered=(format:string):format is typeof RENDERED[number]=>RENDERED.includes(format as never);

interface ExportOptions {
 type?:string;format?:string;output?:string;name?:string;page?:number;force?:boolean;dryRun?:boolean;
 server:string;client?:HttpClient;emit:(value:unknown)=>void;bytes?:(value:Uint8Array)=>void;
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
 if(options.page!==undefined&&format!=='png'&&format!=='jpg')throw new CliError('unsupported_format',`--page selects one slide of an image export, not ${format}.`,'Use --format png or jpg with --page, or export the whole resource.');
 const targets:ExportTarget[]=[];
 for(const input of refs){
  const ref=await resolveReference(input,{root:workspace.root,cwd:workspace.cwd,server:options.server});
  if(rendered(format)){
   // Historical content is not the current head, and the renderer only ever photographs the head.
   if(ref.version!==undefined)throw new CliError('unsupported_version_export',`${input} names version ${ref.version}; rendering photographs the current head.`,'Export csv, json, yaml or original for a historical version.');
   targets.push({ref:input,format,render:true,...(ref.kind==='id'?{id:ref.id}:{path:ref.path,id:publishedHead(workspace,ref.path)})});
  }else targets.push({ref:input,format,render:false,...(ref.kind==='id'?{id:ref.id,...(ref.version?{version:ref.version}:{})}:{path:ref.path,...(ref.version?{version:ref.version}:{})})});
 }
 const destinations=await plan(workspace,targets,options);
 // A dry run reports destinations and the capability each target needs; it renders nothing,
 // writes nothing and never sets up credentials.
 if(options.dryRun){
  options.emit({dry_run:true,operations:targets.map((target,index)=>({ref:target.ref,format:target.format,...(destinations[index]?{path:destinations[index]}:{output:'-'}),
   requires:target.render?'server_rendering':'local_conversion',status:'would_write'}))});
  return true;
 }
 if(targets.some(target=>target.id!==undefined&&!options.client))return false;
 const results:ExportResult[]=[];
 for(const [index,target] of targets.entries()){
  const bytes=target.render
   ?await renderTarget(target,options)
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

async function renderTarget(target:ExportTarget,options:ExportOptions):Promise<Buffer>{
 const renderer=serverRenderer(options.server,options.client);
 const result=target.format==='html'?await renderer.html(target.id!):await renderer.image(target.id!,{format:target.format as 'png'|'jpg',...(options.page!==undefined?{page:options.page}:{})});
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
 const extension=extname(source).toLowerCase();
 if(!['.csv','.json'].includes(extension))throw new CliError('unsupported_format',`${path} has no ${target.format} representation.`,'Export --format original for its bytes, or select a named result with --name.');
 return serialize(readRows(content,extension,path),target.format);
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
 for(const target of targets)if(target.render&&target.path!==undefined)await unchangedHead(workspace,target.path);
 if(options.output==='-')return targets.map(()=>undefined);
 const outputPath=options.output?await confinedPath(workspace.root,resolve(workspace.cwd,options.output)):undefined;
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
