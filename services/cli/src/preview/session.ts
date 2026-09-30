/** File-backed sessions: scope, revision-checked saves, SQL inputs and local comments. No publication. */
import {previewGraph} from './graph';
import {authorFrameResponse} from '../../../app/server/author-frame';
import {createPreviewEditor} from './editor';
import {previewAnnotations} from './annotations';
import {BackendRequestError} from '../../../app/lib/artifact-backend/errors';
import type {DocumentMetadata} from '../document';
import type {RefDataMap} from '../../../app/lib/story/ref-data';
import {imageReferenceId} from '../../../app/lib/story/image-source';
import {fileContentType} from '../../../app/lib/story/file-types';
import {createServer} from 'node:http';
import {readFile,mkdir,realpath} from 'node:fs/promises';
import {join,relative,dirname} from 'node:path';
import type {PreparedStoryRuntime} from '../../../app/lib/story/prepared-runtime';
import {prepareStoryRuntime} from '../../../app/lib/story/prepare-runtime.server';
import {compileStoryCss} from '../../../app/lib/data/story/story-css.server';
import {validateMarkupStructure} from '../../../app/lib/story/local-validation';
import {STORY_THEME_NAMES,type StoryThemeName} from '../../../app/lib/validation/atlas-schemas';
import {collectRefUses} from '../../../app/lib/story/refs';
import {State,withLock} from '../state';
import {configDir} from '../config';
import {networkInterfaces} from 'node:os';
import {randomUUID} from 'node:crypto';
import {parseDocument,writeDocument} from '../document';
import {confinedPath,stageFiles,recoverFiles} from '../journal';
import {digest,atomicWrite} from '../files';
import {parseJsx} from '../../../app/lib/jsx';
import {splitHelmet} from '../../../app/lib/story/helmet';
import {stampNodeIds,nodeIndex} from '../../../app/lib/story/node-ids';
import {parseAnnotationRange} from '../../../app/lib/story/annotation-range';
import type {PreviewComment} from './comments';
import {localInputPath,readLocalDataset,type LocalDataset} from './local-inputs';
import {CliError} from '../errors';
import type {Scalar} from '../../../contracts/src/index';
import {validateQueryValues} from '../../../app/lib/story/query-values';
import {dataflowOf} from '../../../app/lib/story/helmet';
import type {CompiledDataflow} from '../../../app/lib/story/compiled-dataflow';
import {compileLocal,declaredRefs,runLocal} from '../local-dataflow';
import {ISLANDS_PATH,assembleDocument,compileDocument,documentModuleSha,readDocumentModule,renderStoryHtml} from './compiled';

class Refusal extends Error {constructor(readonly status:number,message:string){super(message);}}
export async function startPreview(options:{root:string;files:string[];home:string;localFiles?:Record<string,string>;assets?:string;publicAssets?:string;port?:number;share?:boolean;capture?:boolean;origin?:string;asset?:(id:string)=>Promise<{bytes:Buffer;contentType:string}>;dataset?:(id:string)=>Promise<LocalDataset>}){
 let failure:string|undefined;
 const root=await realpath(options.root),{home}=options;
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
  const prepared=options.assets?(cached?.revision===revision?cached.value:await prepareStoryRuntime({source:doc.body,compiledCss:await compileStoryCss(doc.body,{force:true}),theme:STORY_THEME_NAMES.includes(doc.metadata.theme as StoryThemeName)?doc.metadata.theme as StoryThemeName:null,template:doc.metadata.template??null,colorMode:doc.metadata.colorMode??null,refData,assetsUrl,title:doc.metadata.title??file,chrome:!options.capture,dataflow:{flow}})):undefined;
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
 const save=async(file:string,revision:string,source:string,metadata?:DocumentMetadata)=>withLock(home,root,async()=>{
    const current=await read(file);
    if(revision!==current.revision)throw new Refusal(409,'File changed; draft retained');
    if(typeof source!=='string'||!parseJsx(source).ok)throw new Refusal(400,'Invalid JSX');
    // Preserve durable node anchors and the remote baseline; never accept metadata from browser saves.
    const body=stampNodeIds(source,{previousSource:current.body}).source;
    const bytes=Buffer.from(writeDocument({metadata:metadata??current.metadata,body}));
    await read(file,bytes.toString()); // Validate the proposed tree and dependency scope before writing.
    await mkdir(join(configDir(home),'backups','preview'),{recursive:true});
    await atomicWrite(join(configDir(home),'backups','preview',randomUUID()),current.source);
    await stageFiles(home,root,[{path:file,before:current.revision,data:bytes}]);
    await recoverFiles(home,root);
    return read(file);
 });
 const editor=createPreviewEditor({read,write:save});
 const comments=await State.open(home);
 let url='';
 const server=createServer((req,res)=>{void (async()=>{
  const target=new URL(req.url??'/',url);
  const requestHost=req.headers.host??'';
  const admitted=options.share?new Set([new URL(url).host,...Object.values(networkInterfaces()).flatMap(list=>(list??[]).map(address=>`${address.address.includes(':')?'['+address.address+']':address.address}:${new URL(url).port}`))]):new Set([new URL(url).host]);
  if(!admitted.has(requestHost))throw new Refusal(403,'Unknown host');
  if(req.headers.origin&&req.headers.origin!==`http://${requestHost}`)throw new Refusal(403,'Unrelated origin');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','no-store');
  const json=(value:unknown)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  const workspaceFile=target.pathname.startsWith('/workspace/')?decodeURIComponent(target.pathname.slice('/workspace/'.length)):null;
  const file=workspaceFile??target.searchParams.get('file')??options.files[0]!;
  if(req.method==='GET'&&target.pathname==='/'){res.writeHead(302,{Location:'/workspace/'+file.split('/').map(encodeURIComponent).join('/')+(options.capture?'?capture=1':'')});return res.end();}
  if(req.method==='GET'&&target.pathname==='/document'){const {flow:_flow,declared:_declared,...document}=await read(file);return json(document);}
  if(req.method==='GET'&&target.pathname==='/comments'){await pathFor(file);return json(comments.list<PreviewComment>(root,'preview-comment').map(row=>row.value).filter(comment=>comment.file===file));}
  if(req.method==='GET'&&(target.pathname==='/resource'||workspaceFile&&resources.has(file))){if(!resources.has(file))throw new Refusal(403,'Resource not selected');res.setHeader('Content-Type',fileContentType(file)??'application/octet-stream');return res.end(await readFile(await confinedPath(root,join(root,file))));}
  if(req.method==='GET'&&/^\/a\/[A-Za-z0-9]{6,12}$/.test(target.pathname)){
   const local=options.localFiles?.[target.pathname.slice(3)];
   if(local&&allowed.has(local)){res.writeHead(302,{Location:'/workspace/'+local.split('/').map(encodeURIComponent).join('/')});return res.end();}
  }
  if(req.method==='GET'&&/^\/a\/[A-Za-z0-9]{6,12}$/.test(target.pathname)&&options.origin){res.writeHead(302,{Location:options.origin+target.pathname});return res.end();}
  if(req.method==='GET'&&target.pathname.startsWith('/remote/')){const id=target.pathname.slice(8);const mapped=options.localFiles?.[id];const local=remoteIds.has(id)&&mapped&&resources.has(mapped)?await localInputPath(root,mapped):undefined;if(local){res.setHeader('Content-Type',fileContentType(local)??'application/octet-stream');return res.end(await readFile(await confinedPath(root,join(root,local))));}if(!remoteIds.has(id)||!options.asset)throw new Refusal(403,'Remote reference is not selected');const asset=await options.asset(id);res.setHeader('Content-Type',asset.contentType);return res.end(asset.bytes);}
  if(req.method==='GET'&&target.pathname.startsWith('/fonts/')&&options.publicAssets){const path=await confinedPath(options.publicAssets,target.pathname.slice(1));res.setHeader('Content-Type',fileContentType(path)??'font/woff2');return res.end(await readFile(path));}
  if(req.method==='GET'&&target.pathname==='/logo-128.png'&&options.publicAssets){res.setHeader('Content-Type','image/png');return res.end(await readFile(await confinedPath(options.publicAssets,'logo-128.png')));}
  if((req.method==='GET'||req.method==='HEAD')&&target.pathname==='/author-frame'){const response=authorFrameResponse(new Request(target,{method:req.method}),null,url);res.statusCode=response.status;response.headers.forEach((value,key)=>res.setHeader(key,value));return res.end(Buffer.from(await response.arrayBuffer()));}
  if(req.method==='GET'&&target.pathname==='/files')return json([...allowed]);
  if(req.method==='GET'&&target.pathname==='/query'){
   const raw=target.searchParams.get('q');if(!raw)throw new Refusal(400,'Missing query request');
   let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw new Refusal(400,'Invalid query request');}
   return json(await runQuery(file,parsed as Record<string,unknown>));
  }
  if(req.method==='GET'&&target.pathname==='/image'){
   const current=await read(file),id=imageReferenceId(target.searchParams.get('u')??'');
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
    const annotations=previewAnnotations(comments,root,input.file,current.body);
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
    comments.put(root,'preview-comment',comment.id,comment);return json(comment);
   }
  }
  if(req.method==='GET'&&(target.pathname==='/'||workspaceFile)){
   const current=await read(file);
   if(!current.prepared)throw new Refusal(500,'Local preview has no runtime assets configured.');
   const directory=dirname(file),base='/workspace/'+(directory==='.'?'':directory.split('/').map(encodeURIComponent).join('/')+'/');
   const compiled=await compileDocument({data:current.data,flow:current.flow,authorScript:current.prepared.authorScript,capture:!!options.capture}).catch((error:unknown)=>{if(options.capture)failure=error instanceof Error?error.message:String(error);throw error;});
   // A capture bakes its own rows server-side (as `/raw`'s export path does): nothing for the
   // headless page to wait on after paint, and no reader-side race to detect "settled".
   let story:string|undefined,values:Record<string,Scalar>|undefined;
   if(options.capture){
    const datasets:Record<string,LocalDataset>={};
    for(const id of declaredRefs(current.declared))datasets[id]??=await tableFor(id);
    const ran=await runLocal(current.flow,async id=>datasets[id],{values:{}});
    if(Object.keys(ran.errors).length)failure=Object.values(ran.errors).join('; ');
    values=ran.values;story=await renderStoryHtml(compiled,{values:ran.values,results:{tables:ran.tables,errors:ran.errors}});
   }
   const assembled=assembleDocument({compiled,prepared:current.prepared,colorMode:current.data.colorMode,file,capture:!!options.capture,story,values});
   let html=assembled.html.replace('<head>',`<head><base href="${base}">`)
    .replace('</body>',`<link rel="stylesheet" href="/bundle/chrome.css"><script type="module" src="/bundle/client.js"></script></body>`);
   if(options.capture)html=html.replace('<body','<body data-afbin-export-ready=""');
   res.setHeader('Content-Type','text/html');
   for(const [name,value] of Object.entries(assembled.headers))res.setHeader(name,value);
   return res.end(html);
  }
  if(req.method==='GET'&&target.pathname.startsWith(ISLANDS_PATH+'/')){
   const sha=documentModuleSha(target.pathname);
   if(sha){const bytes=await readDocumentModule(sha);if(!bytes)throw new Refusal(404,'Not found');res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','public, max-age=31536000, immutable');return res.end(Buffer.from(bytes));}
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
 })().catch(error=>{if(options.capture&&req.url!=='/favicon.ico')failure=String(error.message);res.statusCode=error instanceof Refusal||error instanceof BackendRequestError?error.status:500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:String(error.message)}));});});
 try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port??0,options.share?'0.0.0.0':'127.0.0.1',resolve);});}catch(error){comments.close();throw error;}
 const address=server.address();if(!address||typeof address==='string')throw Error('No port');url=`http://127.0.0.1:${address.port}`;
 return {url,document:read,failure:()=>failure,close:async()=>{await queue;server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));comments.close();}};
}
