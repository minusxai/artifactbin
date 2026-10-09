/** Package-owned offline export over the same local compiler, SQL and reader as preview. */
import {readFile,stat} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,dirname,sep,basename} from 'node:path';
import type {LocalHtmlOptions} from './local-html-options';
import {loadWorkspace} from './workspace';
import {parseDocument} from './document';
import {confinedPath} from './journal';
import {localWorkspaceState,LOCAL_WORKSPACE_SCOPE,registerLocalFiles,withLocalLock} from './local-workspace';
import {digest} from './files';
import {CliError} from './errors';
import {localInputPath,localInputReferences,readLocalDataset} from './preview/local-inputs';
import {previewAnnotations} from './preview/annotations';
import {previewGraph,referenceIds} from './preview/graph';
import {fileContentType,collectRefUses,imageReferenceId,dataflowOf,splitHelmet,parseJsx,type JsxNode,validateMarkupStructure,resolveStoredStoryDesign,type RefDataMap,sourceDigest,type ArtifactFile,type ImportTables} from '../../app/lib/cli-toolkit';
import {compileLocal,runLocal} from './local-dataflow';
import {prepareStoryRuntime,compileStoryCss,withStoredCarriers,offlineFileParts,renderArtifactFileHtml,type StoryIslandData,DOCUMENT_UI_FONT_CSS,withoutUnusedFaces} from '../../app/lib/cli-toolkit/host.server';
import {compileDocument,renderStoryHtml,compilerBuild} from './preview/compiled';

const MAX_BYTES=25*1024*1024;
type Assets=NonNullable<ArtifactFile['localWorkspace']>['assets'];
/** Reads the complete dependency snapshot before the packaged compiler runs; references may never trigger a remote fallback. */
export async function prepareLocalHtml(options:LocalHtmlOptions){
 const workspace=await loadWorkspace(options.cwd,options.home);
 const path=relative(workspace.root,await confinedPath(workspace.root,resolve(workspace.cwd,options.path))).split(sep).join('/');
 if((await stat(await confinedPath(workspace.root,path))).size>MAX_BYTES)throw new CliError('export_too_large','The local document exceeds 25 MB.');
 await registerLocalFiles(workspace,[relative(workspace.cwd,join(workspace.root,path))]);
 return withLocalLock(workspace.root,async()=>{
  const localFiles=await localInputReferences(workspace),source=await readFile(await confinedPath(workspace.root,path),'utf8'),document=parseDocument(source);
  if(!path.toLowerCase().endsWith('.jsx'))throw new CliError('unsupported_export','HTML export requires a JSX document.');
  const checked=validateMarkupStructure(document.body),parsed=parseJsx(document.body);
  if(!parsed.ok||checked.errors.length)throw new CliError('invalid_document','The local document is invalid: '+checked.errors.map(error=>error.message).join('; '));
  const identity=Object.entries(localFiles).find(([,mapped])=>mapped===path)?.[0];
  if(!identity)throw new CliError('missing_identity','Register this document before exporting it.');
  const assets:Assets=Object.create(null) as Assets,uris=new Map<string,string>();let total=Buffer.byteLength(source);
  const add=async(id:string,mapped:string)=>{
   if(assets[id])return;
   const input=await localInputPath(workspace.root,mapped);
   if(!input)throw new CliError('missing_local_input',`Reference ${id} has no local bytes. Download it before exporting.`);
   const location=await confinedPath(workspace.root,input),size=(await stat(location)).size;
   if(total+size>MAX_BYTES)throw new CliError('export_too_large','The local HTML snapshot exceeds 25 MB.');
   const bytes=await readFile(location);total+=bytes.length;
   const contentType=fileContentType(input)??'application/octet-stream',base64=bytes.toString('base64');
   assets[id]={path:input,contentType,base64};
   const uri=`data:${contentType};base64,${base64}`;
   for(const pointer of ['ref:'+id,'/remote/'+id,'/a/'+id+'/raw'])uris.set(pointer,uri);
  };
  for(const id of referenceIds(document.body)){
   const mapped=localFiles[id];if(!mapped)throw new CliError('missing_local_input',`Reference ${id} is unavailable locally. Download it before exporting.`);
   await add(id,mapped);
  }
  for(const mapped of await previewGraph(workspace.root,path,localFiles))if(mapped!==path){
   const id=Object.entries(localFiles).find(([,value])=>value===mapped)?.[0];if(id)await add(id,mapped);
  }
  const declared=dataflowOf(splitHelmet(parsed.nodes).content),datasets=new Map<string,Awaited<ReturnType<typeof readLocalDataset>>>();
  const table=async(id:string)=>{
   if(datasets.has(id))return datasets.get(id);
   const mapped=localFiles[id];if(!mapped)throw new CliError('missing_local_input',`Dataset ${id} has no local copy.`);
   const found=await readLocalDataset(workspace.root,mapped,id);if(!found)throw new CliError('missing_local_input',`Dataset ${id} has no stored local rows.`);
   datasets.set(id,found);await add(id,mapped);
   for(const row of found.rows)for(const value of Object.values(row)){const image=typeof value==='string'?imageReferenceId(value):null;if(image){const file=localFiles[image];if(!file)throw new CliError('missing_local_input',`Dataset image ${image} has no local copy.`);await add(image,file);}}
   return found;
  };
  const flow=await compileLocal(declared,table),state=await runLocal(flow,table,{values:{}});
  if(Object.keys(state.errors).length)throw new CliError('invalid_query',Object.values(state.errors).join('; '));
  const held:Record<string,ImportTables[string]>={};for(const imported of flow.imports){const found=await table(imported.ref);if(found)held[imported.name]={rows:found};}
  const store=await localWorkspaceState(workspace.root),annotations=previewAnnotations(store,LOCAL_WORKSPACE_SCOPE,path,document.body);
  const threads=[...annotations.list('open'),...annotations.list('resolved')];
  const refData:RefDataMap={};for(const ref of collectRefUses(document.body)??[]){const asset=assets[ref.id];if(ref.kind==='pdf'&&asset)refData[ref.id]={kind:'pdf',url:uris.get('ref:'+ref.id)!,name:basename(asset.path),bytes:Buffer.from(asset.base64,'base64').length};else if(ref.kind==='image'||ref.kind==='file'||ref.kind==='asset')refData[ref.id]={kind:ref.kind==='image'?'image':'file',url:uris.get('ref:'+ref.id)!};}
  // Explicit relative images travel under generated portable reference IDs; arbitrary absolute/network assets are refused.
  const nodes=async(list:JsxNode[])=>{for(const node of list)if(node.type==='element'){
   for(const attr of node.attributes)if(['src','poster'].includes(attr.name)&&attr.value.static&&typeof attr.value.json==='string'){
    const value=attr.value.json;if(value.startsWith('ref:')||value.startsWith('data:'))continue;
    if(/^(https?:|\/\/|blob:)/i.test(value)||isAbsolute(value))throw new CliError('missing_local_input',`Offline export cannot include remote asset ${value}. Download and reference a local copy.`);
    const local=relative(workspace.root,await confinedPath(workspace.root,resolve(workspace.root,dirname(path),value))).split(sep).join('/');
    const id=Object.entries(localFiles).find(([,mapped])=>mapped===local)?.[0]??digest(local).slice(0,6);if(localFiles[id]&&localFiles[id]!==local)throw new CliError('duplicate_identity','A local asset identity conflicts with another file.');await add(id,local);uris.set(value,uris.get('ref:'+id)!);
   }
   await nodes(node.children);
  }};await nodes(parsed.nodes);
  return {workspace,path,document,identity,assets,uris,flow,state,held,threads,refData};
 });
}

/** The runtime root contains its tested offline bundle, compiler half, fonts and SQLite wasm. */
export async function exportLocalHtml(options:LocalHtmlOptions,assetsRoot:string):Promise<Buffer>{
 const input=await prepareLocalHtml(options),{document,flow,refData}=input;
 process.chdir(resolve(assetsRoot));
 const design=resolveStoredStoryDesign(document.metadata.theme,document.metadata.colorMode);
 const prepared=await prepareStoryRuntime({source:document.body,compiledCss:await compileStoryCss(document.body,{force:true}),theme:design.theme,template:document.metadata.template??null,colorMode:design.colorMode,refData,title:document.metadata.title??input.path,chrome:true,dataflow:{flow,hold:Object.keys(input.held)}});
 const island:StoryIslandData={...prepared.data,refData,dataflow:{flow,hold:Object.keys(input.held)}};
 delete island.queryUrl;delete island.mutateUrl;delete island.assetsUrl;delete island.sqliteWasm;
 let compiled=await compileDocument({data:island,flow,authorScript:prepared.authorScript,capture:false});
 const {ssr:_ssr,graph:_graph,...sharedBuild}=compilerBuild();compiled={...compiled,sharedBuild};
 if(compiled.ssr)compiled={...compiled,html:withStoredCarriers(await renderStoryHtml(compiled,{values:input.state.values,results:input.state}),compiled.html)};
 let embeddedBytes=0;
 const resource=async(pointer:string):Promise<string>=>{
  if(pointer.startsWith('data:')||pointer.startsWith('#'))return pointer;
  const known=input.uris.get(pointer);if(known)return known;
  if(pointer.startsWith('/fonts/')){
   const file=await confinedPath(join(assetsRoot,'public'),pointer.slice(1));const bytes=await readFile(file);embeddedBytes+=bytes.length;
   if(embeddedBytes>MAX_BYTES)throw new CliError('export_too_large','Embedded fonts exceed the 25 MB HTML limit.');
   return `data:${fileContentType(file)??'font/woff2'};base64,${bytes.toString('base64')}`;
  }
  throw new CliError('missing_local_input',`Offline export cannot embed ${pointer}. Use a registered local reference.`);
 };
 const inline=(text:string)=>input.uris.get(text)??text.replace(/\b(src|href|poster)=(["'])([^"']*)\2/g,(original,name:string,quote:string,pointer:string)=>input.uris.has(pointer)?`${name}=${quote}${input.uris.get(pointer)}${quote}`:original);
 const css=async(text:string)=>{
  const sheet=withoutUnusedFaces(text,document.body+(document.metadata.title??input.path)+JSON.stringify(input.state)+JSON.stringify(input.threads));
  const replacements=new Map<string,string>();for(const match of sheet.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g))replacements.set(match[0],`url("${await resource(match[2]!)}")`);
  let result=sheet;for(const [original,replacement] of replacements)result=result.split(original).join(replacement);return result;
 };
 const inlined=<T,>(value:T):T=>{
  const visit=(part:unknown):unknown=>{
   if(typeof part==='string')return inline(part);
   if(Array.isArray(part))return part.map(visit);
   if(part&&typeof part==='object'){
    const record=part as Record<string,unknown>;
    if(record.type==='text'&&typeof record.start==='number'&&typeof record.end==='number')return record;
    return Object.fromEntries(Object.entries(record).map(([key,item])=>[key,visit(item)]));
   }
   return part;
  };return visit(value) as T;
 };
 const now=new Date().toISOString();
 const file:ArtifactFile={format:1,origin:'http://localhost',artifactId:input.identity,liveUrl:'',downloadedBy:'Local workspace',downloadedAt:now,base:{version:0,editId:'',source:document.body},source:document.body,metadata:{title:document.metadata.title??input.path,description:document.metadata.description??null,theme:design.theme,template:document.metadata.template??null,colorMode:design.colorMode},css:{base:await css(prepared.baseCss+'\n'+DOCUMENT_UI_FONT_CSS),compiled:prepared.compiledCss?await css(prepared.compiledCss):null,author:prepared.authorCss?await css(prepared.authorCss):null},island:inlined(island),compiled:inlined(compiled),snapshot:{at:now,state:inlined(input.state),held:inlined(input.held),variants:[],frozen:[]},threads:inlined(input.threads),journal:[],localIds:input.threads.flatMap(thread=>[thread.id,...thread.thread.map(reply=>reply.id)]),bundle:'solid',derivedFrom:sourceDigest(document.body),compiledFlowDigest:sourceDigest(JSON.stringify(island.dataflow?.flow??null)),localWorkspace:{documentId:input.identity,baseDigest:sourceDigest(document.body),threadsDigest:digest(JSON.stringify(input.threads)),metadataBaseline:{title:document.metadata.title??input.path,description:document.metadata.description??null,theme:design.theme,template:document.metadata.template??null,colorMode:design.colorMode},assets:input.assets}};
 const html=Buffer.from(renderArtifactFileHtml(await offlineFileParts(file)));
 if(html.length>MAX_BYTES)throw new CliError('export_too_large','The self-contained HTML file exceeds 25 MB.');
 return html;
}
