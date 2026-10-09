import {PREVIEW_CONNECT_PATH,PREVIEW_CONNECT_INSPECT_PATH,PREVIEW_CONNECT_IMPORT_PATH,PREVIEW_CONNECT_MAX_BYTES} from '../../../contracts/src/preview-connect';
import {previewPublicOrigin} from '../preview-options';
import {inspectPreviewOffer,importPreviewOffer,previewConnectPage} from './connect-import';
import {loadWorkspace} from '../workspace';
import {LOCAL_WORKSPACE_SCOPE,localWorkspaceState,migrateLocalDiscussion,recoverLocalFiles,saveLocalFile} from '../local-workspace';
import {workspaceStateEnv} from '../config';
import {localHistory,localHistoryHead} from '../local-history';
/** File-backed sessions: scope, revision-checked saves, SQL inputs and local comments. No publication. */
import {previewGraph} from './graph';
import {createPreviewEditor} from './editor';
import {previewAnnotations} from './annotations';
import {BackendRequestError} from '../../../app/lib/artifact-backend/errors';
import type {DocumentMetadata} from '../document';
import type {RefDataMap} from '../../../app/lib/dataflow/ref-data';
import {imageReferenceId} from '../../../app/lib/dataflow/image-source';
import {fileContentType} from '../../../app/lib/story/assets/file-types';
import {createServer} from 'node:http';
import {readFile,mkdir,realpath} from 'node:fs/promises';
import {join,relative} from 'node:path';
import type {PreparedStoryRuntime} from '../../../app/lib/story/prepared/prepared-runtime';
import {prepareStoryRuntime} from '../../../app/lib/story/prepared/prepare-runtime.server';
import {compileStoryCss} from '../../../app/lib/data/story/story-css.server';
import {validateMarkupStructure} from '../../../app/lib/story/document/local-validation';
import {STORY_DESIGN_NAMES,type StoryDesignName} from '../../../app/lib/validation/atlas-schemas';
import {collectRefUses} from '../../../app/lib/dataflow/refs';
import {State} from '../state';
import {networkInterfaces} from 'node:os';
import {randomUUID} from 'node:crypto';
import {parseDocument,writeDocument} from '../document';
import {confinedPath} from '../journal';
import {digest} from '../files';
import {parseJsx} from '../../../app/lib/jsx';
import {splitHelmet} from '../../../app/lib/story/document/helmet';
import {stampNodeIds,nodeIndex} from '../../../app/lib/story/document/node-ids';
import {parseAnnotationRange} from '../../../app/lib/story/annotations/annotation-range';
import type {PreviewComment} from './comments';
import {localInputPath,localInputReferences,readLocalDataset,type LocalDataset} from './local-inputs';
import {CliError} from '../errors';
import type {Scalar} from '../../../contracts/src/index';
import {validateQueryValues} from '../../../app/lib/dataflow/query-values';
import {dataflowOf} from '../../../app/lib/story/document/helmet';
import type {CompiledDataflow} from '../../../app/lib/dataflow/compiled-dataflow';
import {compileLocal,declaredRefs,runLocal} from '../local-dataflow';
import {ISLANDS_PATH,assembleDocument,compileDocument,documentModuleSha,readDocumentModule,readSpeculationRules,renderStoryHtml,speculationRulesSha} from './compiled';
import {startupPortFailure} from '../operator-error';

class Refusal extends Error {constructor(readonly status:number,message:string){super(message);}}
export async function startPreview(options:{root:string;files:string[];home:string;localFiles?:Record<string,string>;assets?:string;publicAssets?:string;port?:number;share?:boolean;publicUrl?:string;capture?:boolean;origin?:string;asset?:(id:string)=>Promise<{bytes:Buffer;contentType:string}>;dataset?:(id:string)=>Promise<LocalDataset>}){
 let failure:string|undefined;
 const root=await realpath(options.root),{home}=options;
 const publicOrigin=previewPublicOrigin(options.publicUrl);
 await localWorkspaceState(root);await recoverLocalFiles(root);
 options.localFiles={...options.localFiles,...await localInputReferences(await loadWorkspace(root,home),options.origin)};
 const allowed=new Set(options.files),resources=new Set<string>();
 for(const file of options.files)for(const path of await previewGraph(root,file,options.localFiles)){if(path.toLowerCase().endsWith('.jsx'))allowed.add(path);else resources.add(path);}
 await mkdir(home,{recursive:true});
 let queue:Promise<unknown>=Promise.resolve();
 const serial=<T,>(run:()=>Promise<T>):Promise<T>=>{const next=queue.then(run);queue=next.catch(()=>{});return next;};
 const pathFor=async(file:string)=>{if(!allowed.has(file))throw new Refusal(403,'File is not selected');return confinedPath(root,join(root,file));};
 const preparedCache=new Map<string,{revision:string;value:PreparedStoryRuntime}>();
 const compiledCache=new Map<string,{revision:string;value:CompiledDataflow}>();
 /** A file's compiled declarations, once per revision: compiling reads the shapes of what it imports. */
 const compiledFor=async(file:string,revision:string,declared:ReturnType<typeof dataflowOf>):Promise<CompiledDataflow>=>{
  const cached=compiledCache.get(file);
  if(cached?.revision===revision)return cached.value;
  // A reference preview may not read (403) or a local file it cannot read (422) is that refusal, not a compile error.
  let refused:Refusal|undefined;
  const value=await compileLocal(declared,async id=>tableFor(id).catch(error=>{if(error instanceof Refusal)refused??=error;return undefined;})).catch(error=>{throw refused??(error instanceof Refusal?error:new Refusal(400,error instanceof Error?error.message:String(error)));});
  compiledCache.set(file,{revision,value});return value;
 };
 // Only refs in selected dataset inputs extend preview's asset scope. Query SQL
 // can synthesize arbitrary strings, so its results cannot grant this authority.
 const datasetImages=new Map<string,Set<string>>();
 const read=async(file:string,override?:string)=>{
  const path=await pathFor(file),source=override??await readFile(path,'utf8'),doc=parseDocument(source);
  const rendered=doc.body;

  const refData:RefDataMap={};
  const parsed=parseJsx(rendered);if(!parsed.ok)throw new Refusal(400,'Invalid JSX');
  const checked=validateMarkupStructure(rendered);if(checked.errors.length)throw new Refusal(400,checked.errors.map(error=>error.message).join('\n'));
  for(const ref of collectRefUses(doc.body)??[])if(ref.kind==='image'||ref.kind==='file')refData[ref.id]={kind:ref.kind,url:'/remote/'+ref.id};
  if(override&&(collectRefUses(doc.body)??[]).some(ref=>!remoteIds.has(ref.id)))throw new Refusal(403,'Restart preview to include this reference.');
  const authored=parseJsx(doc.body);if(!authored.ok)throw new Refusal(400,'Invalid JSX');
  const split=splitHelmet(parsed.nodes),declared=dataflowOf(split.content);
  const revision=digest(source);
  const flow=await compiledFor(file,revision,declared);
  const assetsUrl='/image?file='+encodeURIComponent(file);
  const cached=preparedCache.get(file);
  const prepared=options.assets?(cached?.revision===revision?cached.value:await prepareStoryRuntime({source:doc.body,compiledCss:await compileStoryCss(doc.body,{force:true}),theme:STORY_DESIGN_NAMES.includes(doc.metadata.theme as StoryDesignName)?doc.metadata.theme as StoryDesignName:null,template:doc.metadata.template??null,colorMode:doc.metadata.colorMode??null,refData,assetsUrl,title:doc.metadata.title??file,chrome:!options.capture,dataflow:{flow}})):undefined;
  if(prepared)preparedCache.set(file,{revision,value:prepared});
  return {prepared,source,body:doc.body,metadata:doc.metadata,revision:digest(source),declared,flow,data:{...prepared?.data,nodes:splitHelmet(authored.nodes).body,refData,assetsUrl,colorMode:prepared?.data.colorMode??'light' as const,chrome:!options.capture,dataflow:{flow}}};
 };
 const remoteIds=new Set<string>();
 // The selected files' references, declarations included, are the whole scope a session may reach.
 for(const file of allowed){const body=parseDocument(await readFile(await pathFor(file),'utf8')).body;for(const ref of collectRefUses(body)??[])remoteIds.add(ref.id);}
 /** A referenced dataset's rows: its local copy when the workspace has one, else the host's. */
 const tableFor=async(id:string):Promise<LocalDataset>=>{
  if(!remoteIds.has(id))throw new Refusal(403,'Remote reference is not selected');
  const local=options.localFiles?.[id];
  if(local&&resources.has(local)){
   const table=await readLocalDataset(root,local,id).catch(error=>{throw error instanceof CliError?new Refusal(422,error.message):error;});
   if(table)return table;
  }
  if(!options.dataset)throw new Refusal(422,`Remote dataset ${id} requires its host connection`);
  return options.dataset(id);
 };
 /** The compiled reader's own query door: an anonymous GET (`?q=`, `lib/story-runtime/fetch-transport`'s default) or this editor's POST. */
 const runQuery=async(file:string,input:{values?:unknown;only?:unknown;page?:unknown;tz?:unknown})=>{
  // A document that does not compile fails the capture as a query error would: the export names it.
  const current=await read(file).catch((error:unknown)=>{if(options.capture&&error instanceof Refusal)failure=error.message;throw error;}),datasets:Record<string,LocalDataset>={};
  const invalid=validateQueryValues(current.flow,(input.values as Record<string,Scalar>)??{});if(invalid)throw new Refusal(400,invalid.code);
  for(const id of declaredRefs(current.declared))datasets[id]??=await tableFor(id);
  for(const [id,table] of Object.entries(datasets))datasetImages.set(id,new Set(table.rows.flatMap(row=>Object.values(row).flatMap(value=>{const ref=typeof value==='string'?imageReferenceId(value):null;return ref?[ref]:[];}))));
  const result=await runLocal(current.flow,async id=>datasets[id],{values:input.values as Record<string,Scalar>,only:input.only as string[]|undefined,page:input.page as never,tz:typeof input.tz==='string'?input.tz:undefined});
  if(options.capture&&Object.keys(result.errors).length)failure=Object.values(result.errors).join("; ");
  return result;
 };
 const save=async(file:string,revision:string,source:string,metadata?:DocumentMetadata)=>{
    const current=await read(file);
    if(revision!==current.revision)throw new Refusal(409,'File changed; draft retained');
    if(typeof source!=='string'||!parseJsx(source).ok)throw new Refusal(400,'Invalid JSX');
    // Preserve durable node anchors and the remote baseline; never accept metadata from browser saves.
    const body=stampNodeIds(source,{previousSource:current.body}).source;
    const bytes=Buffer.from(writeDocument({metadata:metadata??current.metadata,body}));
    await read(file,bytes.toString()); // Validate the proposed tree and dependency scope before writing.
    await saveLocalFile(root,file,current.revision,bytes).catch(error=>{if(error instanceof CliError&&error.code==='stale_save')throw new Refusal(409,error.message);throw error;});
    return read(file);
 };
 const editor=createPreviewEditor({read,write:save,history:file=>localHistory(root,file),version:async(file,revision)=>{
  try{return (await localHistoryHead(root,file,revision)).version;}catch(error){if(error instanceof CliError&&error.code==='stale_save')throw new Refusal(409,error.message);throw error;}
 }});
 const comments=await State.open(root,workspaceStateEnv(root));
 await migrateLocalDiscussion(root,home,comments);
 const admitImport=async(path:string)=>{
  const identities={...options.localFiles,...await localInputReferences(await loadWorkspace(root,home),options.origin)};
  const graph=await previewGraph(root,path,identities),refs=new Set<string>();
  // Prepare the new graph first. Unrelated previously selected files may have been deleted externally.
  for(const selected of graph)if(selected.toLowerCase().endsWith('.jsx')){
   const body=parseDocument(await readFile(await confinedPath(root,join(root,selected)),'utf8')).body;
   for(const ref of collectRefUses(body)??[])refs.add(ref.id);
  }
  Object.assign(options.localFiles!,identities);
  for(const selected of graph){if(selected.toLowerCase().endsWith('.jsx'))allowed.add(selected);else resources.add(selected);}
  for(const id of refs)remoteIds.add(id);
  preparedCache.delete(path);compiledCache.delete(path);
 };
 let url='';
 const server=createServer((req,res)=>{void (async()=>{
  const target=new URL(req.url??'/',url);
  const requestHost=req.headers.host??'';
  const admitted=options.share?new Set([new URL(url).host,...Object.values(networkInterfaces()).flatMap(list=>(list??[]).map(address=>`${address.address.includes(':')?'['+address.address+']':address.address}:${new URL(url).port}`))]):new Set([new URL(url).host]);
  admitted.add(`localhost:${new URL(url).port}`);
  const localHost=admitted.has(requestHost);
  if(publicOrigin)admitted.add(new URL(publicOrigin).host);
  if(!admitted.has(requestHost))throw new Refusal(403,'Unknown host');
  const sameOrigin=localHost&&req.headers.origin===`http://${requestHost}`||!!publicOrigin&&req.headers.origin===publicOrigin;
  if(req.headers.origin&&!sameOrigin)throw new Refusal(403,'Unrelated origin');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','no-store');
  const json=(value:unknown)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  if(req.method==='GET'&&(target.pathname===PREVIEW_CONNECT_PATH||target.pathname==='/'&&!options.files.length)){
   if(options.capture)throw new Refusal(403,'Image export is read-only');
   res.setHeader('Content-Type','text/html');
   res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
   return res.end(previewConnectPage());
  }
  if(req.method==='POST'&&(target.pathname===PREVIEW_CONNECT_INSPECT_PATH||target.pathname===PREVIEW_CONNECT_IMPORT_PATH)){
   if(options.capture)throw new Refusal(403,'Image export is read-only');
   if(!req.headers.origin||!sameOrigin)throw new Refusal(403,'A same-origin browser confirmation is required');
   if(!req.headers['content-type']?.startsWith('application/json'))throw new Refusal(400,'Expected a JSON import offer');
   // JSON escaping expands HTML; transport is bounded independently from the decoded 25 MB file limit.
   const chunks:Buffer[]=[];let length=0;
   for await(const chunk of req){const bytes=Buffer.from(chunk);length+=bytes.length;if(length>2*PREVIEW_CONNECT_MAX_BYTES)throw new Refusal(413,'Body too large');chunks.push(bytes);}
   let input:unknown;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Refusal(400,'Invalid import offer');}
   if(target.pathname===PREVIEW_CONNECT_INSPECT_PATH){const {html:_html,...inspected}=inspectPreviewOffer(input);return json(inspected);}
   return json(await serial(async()=>{const imported=await importPreviewOffer(root,home,input);await admitImport(imported.path);return {...imported,file:imported.path,path:'/workspace/'+imported.path.split('/').map(encodeURIComponent).join('/')};}));
  }
  const workspaceFile=target.pathname.startsWith('/workspace/')?decodeURIComponent(target.pathname.slice('/workspace/'.length)):null;
  const file=workspaceFile??target.searchParams.get('file')??options.files[0]!;
  if(req.method==='GET'&&target.pathname==='/'){res.writeHead(302,{Location:'/workspace/'+file.split('/').map(encodeURIComponent).join('/')+(options.capture?'?capture=1':'')});return res.end();}
  if(req.method==='GET'&&target.pathname==='/document'){const {flow:_flow,declared:_declared,...document}=await read(file);return json(document);}
  if(req.method==='GET'&&target.pathname==='/comments'){await pathFor(file);return json(comments.list<PreviewComment>(LOCAL_WORKSPACE_SCOPE,'preview-comment').map(row=>row.value).filter(comment=>comment.file===file));}
  if(req.method==='GET'&&(target.pathname==='/resource'||workspaceFile&&resources.has(file))){if(!resources.has(file))throw new Refusal(403,'Resource not selected');res.setHeader('Content-Type',fileContentType(file)??'application/octet-stream');return res.end(await readFile(await confinedPath(root,join(root,file))));}
  if(req.method==='GET'&&/^\/a\/[A-Za-z0-9]{6,12}$/.test(target.pathname)){
   const local=options.localFiles?.[target.pathname.slice(3)];
   if(local&&allowed.has(local)){res.writeHead(302,{Location:'/workspace/'+local.split('/').map(encodeURIComponent).join('/')});return res.end();}
  }
  if(req.method==='GET'&&/^\/a\/[A-Za-z0-9]{6,12}$/.test(target.pathname)&&options.origin){res.writeHead(302,{Location:options.origin+target.pathname});return res.end();}
  if(req.method==='GET'&&target.pathname.startsWith('/remote/')){const id=target.pathname.slice(8);const mapped=options.localFiles?.[id];const local=remoteIds.has(id)&&mapped&&resources.has(mapped)?await localInputPath(root,mapped):undefined;if(local){res.setHeader('Content-Type',fileContentType(local)??'application/octet-stream');return res.end(await readFile(await confinedPath(root,join(root,local))));}if(!remoteIds.has(id)||!options.asset)throw new Refusal(403,'Remote reference is not selected');const asset=await options.asset(id);res.setHeader('Content-Type',asset.contentType);return res.end(asset.bytes);}
  if(req.method==='GET'&&target.pathname.startsWith('/fonts/')&&options.publicAssets){const path=await confinedPath(options.publicAssets,target.pathname.slice(1));res.setHeader('Content-Type',fileContentType(path)??'font/woff2');return res.end(await readFile(path));}
  if(req.method==='GET'&&target.pathname==='/logo-128.png'&&options.publicAssets){res.setHeader('Content-Type','image/png');return res.end(await readFile(await confinedPath(options.publicAssets,'logo-128.png')));}
  if(req.method==='GET'&&target.pathname==='/files')return json([...allowed]);
  if(req.method==='GET'&&target.pathname==='/query'){
   const raw=target.searchParams.get('q');if(!raw)throw new Refusal(400,'Missing query request');
   let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw new Refusal(400,'Invalid query request');}
   return json(await runQuery(file,parsed as Record<string,unknown>));
  }
  if(req.method==='GET'&&(target.pathname==='/image'||/^\/a\/[A-Za-z0-9]{6,12}\/raw$/.test(target.pathname))){
   // The compiled Select/image kit hardcodes a row-sourced ref's own URL as `/a/<id>/raw`, production's
   // artifact-bytes route (lib/islands/kit/image.tsx) — never `/image?u=`, which only a document's own
   // authored `ref:` attributes resolve through (refData, in read() below).
   const id=target.pathname==='/image'?imageReferenceId(target.searchParams.get('u')??''):target.pathname.slice(3,-4);
   const current=await read(file);
   const sources=declaredRefs(current.declared);
   if(!id||!sources.some(source=>datasetImages.get(source)?.has(id)))throw new Refusal(403,'Image reference is not selected');
   const mapped=options.localFiles?.[id],local=mapped?await localInputPath(root,mapped):undefined;
   const asset=local?{bytes:await readFile(await confinedPath(root,join(root,local))),contentType:fileContentType(local)??'application/octet-stream'}:await options.asset?.(id);
   if(!asset||!asset.contentType.startsWith('image/'))throw new Refusal(404,'Image unavailable');
   res.setHeader('Content-Type',asset.contentType);return res.end(asset.bytes);
  }
  if(options.capture&&req.method!=='GET'&&!(req.method==='POST'&&target.pathname==='/query'))throw new Refusal(403,'Image export is read-only');
  if(req.method==='POST'){
   let bytes='';for await(const chunk of req){bytes+=chunk;if(bytes.length>1_000_000)throw new Refusal(413,'Body too large');}
   const input=JSON.parse(bytes);
   // A compiled island's own POST (its query door is `/query?file=`) carries no body field for it.
   if(typeof input.file!=='string')input.file=file;
   await pathFor(input.file);
   if(target.pathname==='/save')return json(await serial(()=>save(input.file,input.revision,input.body)));
   if(target.pathname==='/editor')return json(await serial(async()=>{
    if(input.operation==='load')return editor.load(input.file);
    if(input.operation==='commit')return editor.commit(input.file,input);
    if(input.operation==='versions')return editor.versions(input.file);
    if(input.operation==='version')return editor.version(input.file,input.version);
    if(input.operation==='revert')return editor.revert(input.file,input);
    const current=await read(input.file);
    if(input.operation==='prepare'){
     if(typeof input.markup!=='string')throw new Refusal(400,'Invalid markup');
     if((collectRefUses(input.markup)??[]).some(ref=>!remoteIds.has(ref.id)))throw new Refusal(403,'Restart preview to include this reference.');
     return {};
    }
    if(input.operation==='css')return {css:await compileStoryCss(String(input.markup),{force:true})};
    if(input.operation==='queries'){
     const draft=await read(input.file,writeDocument({metadata:current.metadata,body:String(input.markup)}));
     return {...await runLocal(draft.flow,tableFor,{values:{}}),flow:draft.flow};
    }
    const annotations=previewAnnotations(comments,LOCAL_WORKSPACE_SCOPE,input.file,current.body);
    if(input.operation==='annotations.list')return annotations.list(input.status);
    if(input.operation==='annotations.create')return annotations.create(input.input??{},input.key);
    if(input.operation==='annotations.act')return annotations.act(input.id,input.input??{});
    if(input.operation==='annotations.delete'){annotations.delete(input.id);return null;}
    throw new Refusal(400,'Unknown editor operation');
   }));
   if(target.pathname==='/query')return json(await runQuery(input.file,input));
   if(target.pathname==='/draft'){
    // Ephemeral compile of the editor's in-flight text — never staged, never written.
    if(typeof input.source!=='string')throw new Refusal(400,'Invalid draft');
    const current=await read(input.file);
    const draft=await read(input.file,writeDocument({metadata:current.metadata,body:input.source}));
    if(!draft.prepared)throw new Refusal(500,'Local preview has no runtime assets configured.');
    const compiled=await compileDocument({data:draft.data,flow:draft.flow,authorScript:draft.prepared.authorScript,capture:false});
    const assembled=assembleDocument({compiled,prepared:draft.prepared,colorMode:draft.data.colorMode,file:input.file,capture:false});
    return json({html:assembled.html});
   }
   if(target.pathname==='/comments'){
    const current=await read(input.file);
    // Comments refer to durable authored node IDs, never a transient DOM position.
    const range=input.range==null?null:parseAnnotationRange(input.range);
    if(typeof input.node!=='string'||!nodeIndex(current.body).has(input.node)||typeof input.name!=='string'||!input.name.trim()||input.name.length>100||typeof input.text!=='string'||!input.text.trim()||input.text.length>10000||input.range!=null&&!range||input.quote!==undefined&&(typeof input.quote!=='string'||input.quote.length>10000))throw new Refusal(400,'Invalid comment');
    const comment:PreviewComment={id:randomUUID(),file:input.file,node:input.node,name:input.name.trim(),text:input.text.trim(),...(input.quote!==undefined?{quote:input.quote}:{}),range};
    comments.put(LOCAL_WORKSPACE_SCOPE,'preview-comment',comment.id,comment);return json(comment);
   }
  }
  if(req.method==='GET'&&(target.pathname==='/'||workspaceFile)){
   const current=await read(file);
   if(!current.prepared)throw new Refusal(500,'Local preview has no runtime assets configured.');
   const compiled=await compileDocument({data:current.data,flow:current.flow,authorScript:current.prepared.authorScript,capture:!!options.capture}).catch((error:unknown)=>{if(options.capture)failure=error instanceof Error?error.message:String(error);throw error;});
   // A capture bakes its own rows server-side (as `/raw`'s export path does): nothing for the
   // headless page to wait on after paint, and no reader-side race to detect "settled".
   let story:string|undefined,values:Record<string,Scalar>|undefined;
   if(options.capture){
    const datasets:Record<string,LocalDataset>={};
    for(const id of declaredRefs(current.declared))datasets[id]??=await tableFor(id);
    // The same bookkeeping the /query POST does: an image ref inside a row is only servable once its
    // dataset has actually been read, capture included (a capture never calls /query itself).
    for(const [id,table] of Object.entries(datasets))datasetImages.set(id,new Set(table.rows.flatMap(row=>Object.values(row).flatMap(value=>{const ref=typeof value==='string'?imageReferenceId(value):null;return ref?[ref]:[];}))));
    const ran=await runLocal(current.flow,async id=>datasets[id],{values:{}});
    if(Object.keys(ran.errors).length)failure=Object.values(ran.errors).join('; ');
    values=ran.values;story=await renderStoryHtml(compiled,{values:ran.values,results:{tables:ran.tables,errors:ran.errors}});
   }
   const assembled=assembleDocument({compiled,prepared:current.prepared,colorMode:current.data.colorMode,file,capture:!!options.capture,story,values});
   let html=assembled.html;
   // A capture is the document alone, as /a/:id/raw serves it. The editor's chrome sheet is the app's own
   // globals, whose `body` rules (a mono family, 14px) would restyle every element the design's root family
   // reaches, and its client mounts nothing under `?capture=1` anyway (preview/client.tsx).
   if(options.capture)html=html.replace('<body','<body data-afbin-export-ready=""');
   else html=html.replace('</body>',`<script type="module" src="/bundle/client.js"></script></body>`);
   res.setHeader('Content-Type','text/html');
   for(const [name,value] of Object.entries(assembled.headers))res.setHeader(name,value);
   return res.end(html);
  }
  if(req.method==='GET'&&target.pathname.startsWith(ISLANDS_PATH+'/')){
   const sha=documentModuleSha(target.pathname);
   if(sha){const bytes=await readDocumentModule(sha);if(!bytes)throw new Refusal(404,'Not found');res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','public, max-age=31536000, immutable');return res.end(Buffer.from(bytes));}
   const rulesSha=speculationRulesSha(target.pathname);
   if(rulesSha){const bytes=await readSpeculationRules(rulesSha);if(!bytes)throw new Refusal(404,'Not found');res.setHeader('Content-Type','application/speculationrules+json');res.setHeader('Cache-Control','public, max-age=31536000, immutable');return res.end(Buffer.from(bytes));}
   if(!options.publicAssets)throw new Refusal(404,'Not found');
   const path=await confinedPath(options.publicAssets,target.pathname.slice(1));
   // The shared build's own chunks: `fileContentType` knows document/dataset kinds, not `.js`/`.wasm`.
   const type=path.endsWith('.js')?'text/javascript':path.endsWith('.wasm')?'application/wasm':fileContentType(path)??'application/octet-stream';
   res.setHeader('Content-Type',type);res.setHeader('Cache-Control','public, max-age=31536000, immutable');return res.end(await readFile(path));
  }
  if(req.method==='GET'&&target.pathname.startsWith('/bundle/')&&options.assets){
   const path=await confinedPath(options.assets,target.pathname.slice('/bundle/'.length));
   const extension=relative(options.assets,path).endsWith('.css')?'css':relative(options.assets,path).endsWith('.js')?'js':null;
   if(!extension)throw new Refusal(403,'Not a preview asset');
   res.setHeader('Content-Type',extension==='css'?'text/css':'text/javascript');return res.end(await readFile(path));
  }
  throw new Refusal(404,'Not found');
 })().catch(error=>{if(options.capture&&req.url!=='/favicon.ico')failure=String(error.message);res.statusCode=error instanceof Refusal||error instanceof BackendRequestError?error.status:error instanceof CliError?(error.code==='import_conflict'?409:400):500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:String(error.message),...(error instanceof CliError&&error.fix?{fix:error.fix}:{})}));});});
 try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port??0,options.share?'0.0.0.0':'127.0.0.1',resolve);});}catch(error){comments.close();throw startupPortFailure(error,options.port??0);}
 const address=server.address();if(!address||typeof address==='string')throw Error('No port');url=`http://127.0.0.1:${address.port}`;
 return {url,document:read,failure:()=>failure,close:async()=>{await queue;server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));comments.close();}};
}
