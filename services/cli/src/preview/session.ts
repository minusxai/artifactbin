/** File-backed sessions: scope, revision-checked saves, SQL inputs and local comments. No publication. */
import {previewGraph} from './graph';
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
import {stampNodeIds} from '../../../app/lib/story/node-ids';
import {parseCsv} from '../../../app/lib/data-ingest/csv';
import {coerceRows} from '../../../app/lib/data-ingest/coerce';
import {inferColumns} from '../../../utils/src/shape';
import {evaluateDataflow,type DatasetTables} from '../../../app/lib/sql/dataflow-core';
import {createSql} from '../../../sql/src/local';
import {tableQueryInput} from '../../../utils/src/index';
import {isQueryFailure,type Scalar} from '../../../contracts/src/index';
import {validateQueryValues} from '../../../app/lib/story/query-values';

class Refusal extends Error {constructor(readonly status:number,message:string){super(message);}}
export async function startPreview(options:{root:string;files:string[];home:string;localFiles?:Record<string,string>;assets?:string;publicAssets?:string;port?:number;share?:boolean;capture?:boolean;origin?:string;asset?:(id:string)=>Promise<{bytes:Buffer;contentType:string}>;dataset?:(id:string)=>Promise<DatasetTables[string]>}){
 let failure:string|undefined;
 const root=await realpath(options.root),{home}=options;
 const allowed=new Set(options.files),resources=new Set<string>();
 for(const file of options.files)for(const path of await previewGraph(root,file,options.localFiles)){if(path.toLowerCase().endsWith('.jsx'))allowed.add(path);else resources.add(path);}
 await mkdir(home,{recursive:true});
 type Comment={id:string;file:string;node:string;name:string;text:string};
 let queue:Promise<unknown>=Promise.resolve();
 const serial=<T,>(run:()=>Promise<T>):Promise<T>=>{const next=queue.then(run);queue=next.catch(()=>{});return next;};
 const pathFor=async(file:string)=>{if(!allowed.has(file))throw new Refusal(403,'File is not selected');return confinedPath(root,join(root,file));};
 const preparedCache=new Map<string,{revision:string;value:PreparedStoryRuntime}>();
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
  const split=splitHelmet(parsed.nodes),flow={values:split.content.values,queries:split.content.queries,mutations:split.content.mutations};
  const revision=digest(source);
  const assetsUrl='/image?file='+encodeURIComponent(file);
  const cached=preparedCache.get(file);
  const prepared=options.assets?(cached?.revision===revision?cached.value:await prepareStoryRuntime({source:doc.body,compiledCss:await compileStoryCss(doc.body,{force:true}),theme:STORY_THEME_NAMES.includes(doc.metadata.theme as StoryThemeName)?doc.metadata.theme as StoryThemeName:null,template:doc.metadata.template??null,colorMode:doc.metadata.colorMode??null,refData,assetsUrl,title:doc.metadata.title??file,chrome:!options.capture,dataflow:{flow}})):undefined;
  if(prepared)preparedCache.set(file,{revision,value:prepared});
  return {prepared,source,body:doc.body,metadata:doc.metadata,revision:digest(source),flow,data:{...prepared?.data,nodes:splitHelmet(authored.nodes).body,refData,assetsUrl,colorMode:prepared?.data.colorMode??'light' as const,chrome:!options.capture,dataflow:{flow}}};
 };
 const remoteIds=new Set<string>();
 for(const file of allowed){const current=await read(file);for(const ref of collectRefUses(current.body)??[])remoteIds.add(ref.id);for(const query of current.flow.queries)for(const id of query.source?[query.source]:query.refs)remoteIds.add(id);}
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
  if(req.method==='GET'&&target.pathname==='/document'){const {flow:_flow,...document}=await read(file);return json(document);}
  if(req.method==='GET'&&target.pathname==='/comments'){await pathFor(file);return json(comments.list<Comment>(root,'preview-comment').map(row=>row.value).filter(comment=>comment.file===file));}
  if(req.method==='GET'&&(target.pathname==='/resource'||workspaceFile&&resources.has(file))){if(!resources.has(file))throw new Refusal(403,'Resource not selected');res.setHeader('Content-Type',fileContentType(file)??'application/octet-stream');return res.end(await readFile(await confinedPath(root,join(root,file))));}
  if(req.method==='GET'&&/^\/a\/[A-Za-z0-9]{6,12}$/.test(target.pathname)){
   const local=options.localFiles?.[target.pathname.slice(3)];
   if(local&&allowed.has(local)){res.writeHead(302,{Location:'/workspace/'+local.split('/').map(encodeURIComponent).join('/')});return res.end();}
  }
  if(req.method==='GET'&&/^\/a\/[A-Za-z0-9]{6,12}$/.test(target.pathname)&&options.origin){res.writeHead(302,{Location:options.origin+target.pathname});return res.end();}
  if(req.method==='GET'&&target.pathname.startsWith('/remote/')){const id=target.pathname.slice(8);const local=options.localFiles?.[id];if(remoteIds.has(id)&&local&&resources.has(local)){res.setHeader('Content-Type',fileContentType(local)??'application/octet-stream');return res.end(await readFile(await confinedPath(root,join(root,local))));}if(!remoteIds.has(id)||!options.asset)throw new Refusal(403,'Remote reference is not selected');const asset=await options.asset(id);res.setHeader('Content-Type',asset.contentType);return res.end(asset.bytes);}
  if(req.method==='GET'&&target.pathname.startsWith('/fonts/')&&options.publicAssets){const path=await confinedPath(options.publicAssets,target.pathname.slice(1));res.setHeader('Content-Type',fileContentType(path)??'font/woff2');return res.end(await readFile(path));}
  if(req.method==='GET'&&target.pathname==='/files')return json([...allowed]);
  if(req.method==='GET'&&target.pathname==='/image'){
   const current=await read(file),id=imageReferenceId(target.searchParams.get('u')??'');
   const sources=current.flow.queries.flatMap(query=>query.source?[query.source]:query.refs);
   if(!id||!sources.some(source=>datasetImages.get(source)?.has(id)))throw new Refusal(403,'Image reference is not selected');
   const local=options.localFiles?.[id];
   const asset=local?{bytes:await readFile(await confinedPath(root,join(root,local))),contentType:fileContentType(local)??'application/octet-stream'}:await options.asset?.(id);
   if(!asset||!asset.contentType.startsWith('image/'))throw new Refusal(404,'Image unavailable');
   res.setHeader('Content-Type',asset.contentType);return res.end(asset.bytes);
  }
  if(options.capture&&req.method!=='GET'&&!(req.method==='POST'&&target.pathname==='/query'))throw new Refusal(403,'Image export is read-only');
  if(req.method==='POST'){
   let bytes='';for await(const chunk of req){bytes+=chunk;if(bytes.length>1_000_000)throw new Refusal(413,'Body too large');}
   const input=JSON.parse(bytes);await pathFor(input.file);
   if(target.pathname==='/save')return json(await serial(()=>withLock(home,root,async()=>{
    const current=await read(input.file);
    if(input.revision!==current.revision)throw new Refusal(409,'File changed; draft retained');
    if(typeof input.body!=='string'||!parseJsx(input.body).ok)throw new Refusal(400,'Invalid JSX');
    // Preserve durable node anchors and the remote baseline; never accept metadata from browser saves.
    const body=stampNodeIds(input.body,{previousSource:current.body}).source;
    const bytes=Buffer.from(writeDocument({metadata:current.metadata,body}));
    await read(input.file,bytes.toString()); // Validate the proposed tree and dependency scope before writing.
    await mkdir(join(configDir(home),'backups','preview'),{recursive:true});
    await atomicWrite(join(configDir(home),'backups','preview',randomUUID()),current.source);
    await stageFiles(home,root,[{path:input.file,before:current.revision,data:bytes}]);
    await recoverFiles(home,root);
    return read(input.file);
   })));
   if(target.pathname==='/query'){
    const current=await read(input.file),datasets:DatasetTables={};
    const invalid=validateQueryValues(current.flow,input.values??{});if(invalid)throw new Refusal(400,invalid.code);
    const refs=new Set(current.flow.queries.flatMap(query=>query.source?[query.source]:query.refs));
    for(const id of refs)if(!datasets[id]){
     if(!remoteIds.has(id))throw new Refusal(403,'Remote reference is not selected');
     const local=options.localFiles?.[id];
     if(local&&resources.has(local)){
      const bytes=await readFile(await confinedPath(root,join(root,local)),'utf8');
      const csv=local.endsWith('.csv')?parseCsv(bytes):null;
      const rows=csv?coerceRows(csv.headers,csv.rows):JSON.parse(bytes);
      datasets[id]={rows,columns:inferColumns(rows)};continue;
     }
     if(!options.dataset)throw new Refusal(422,`Remote dataset ${id} requires its host connection`);
     datasets[id]=await options.dataset(id);
    }
    for(const [id,table] of Object.entries(datasets))datasetImages.set(id,new Set(table.rows.flatMap(row=>Object.values(row).flatMap(value=>{const ref=typeof value==='string'?imageReferenceId(value):null;return ref?[ref]:[];}))));
    const sql=createSql();
    const result=await evaluateDataflow({run:args=>sql.run(args),queryRows:async(table,query,params,page)=>{
     const result=(await sql.run(tableQueryInput(table,query,params,page))).result;
     if(!result||isQueryFailure(result))throw Error(result?.error??'No result');return result;
    }},current.flow,datasets,{values:input.values as Record<string,Scalar>,only:input.only,page:input.page});
    if(options.capture&&Object.keys(result.errors).length)failure=Object.values(result.errors).join("; ");
    return json(result);
   }
   if(target.pathname==='/comments'){
    const current=await read(input.file);
    // Comments refer to durable authored node IDs, never a transient DOM position.
    if(typeof input.node!=='string'||!current.body.includes(`id="${input.node}"`)||typeof input.name!=='string'||!input.name.trim()||input.name.length>100||typeof input.text!=='string'||!input.text.trim()||input.text.length>10000)throw new Refusal(400,'Invalid comment');
    const comment={id:randomUUID(),file:input.file,node:input.node,name:input.name,text:input.text};
    comments.put(root,'preview-comment',comment.id,comment);return json(comment);
   }
  }
  if(req.method==='GET'&&(target.pathname==='/'||workspaceFile)){await pathFor(file);const directory=dirname(file);const base='/workspace/'+(directory==='.'?'':directory.split('/').map(encodeURIComponent).join('/')+'/');res.setHeader('Content-Type','text/html');return res.end(`<!doctype html><html><head><meta charset="utf-8"><base href="${base}"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Artifactbin preview</title><style>.afbin-tools{font:14px system-ui,sans-serif;padding:20px;background:#f8fafc;color:#0f172a;border-bottom:1px solid #cbd5e1}.afbin-tools nav{display:flex;gap:16px;flex-wrap:wrap;margin:12px 0}.afbin-tools label{display:block;margin:12px 0}.afbin-tools input,.afbin-tools textarea,.afbin-tools select{display:block;box-sizing:border-box;max-width:100%;padding:8px;border:1px solid #94a3b8;border-radius:4px;background:white;color:#0f172a}.afbin-tools textarea{width:100%;font:13px ui-monospace,monospace}.afbin-tools button{padding:8px 12px;margin-right:8px;cursor:pointer}</style></head><body><div id="root"></div><script type="module" src="/bundle/client.js"></script></body></html>`);}
  if(req.method==='GET'&&target.pathname.startsWith('/bundle/')&&options.assets){
   const path=await confinedPath(options.assets,target.pathname.slice('/bundle/'.length));
   if(!relative(options.assets,path).endsWith('.js'))throw new Refusal(403,'Not a script');
   res.setHeader('Content-Type','text/javascript');return res.end(await readFile(path));
  }
  throw new Refusal(404,'Not found');
 })().catch(error=>{if(options.capture&&req.url!=='/favicon.ico')failure=String(error.message);res.statusCode=error instanceof Refusal?error.status:500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:String(error.message)}));});});
 try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port??0,options.share?'0.0.0.0':'127.0.0.1',resolve);});}catch(error){comments.close();throw error;}
 const address=server.address();if(!address||typeof address==='string')throw Error('No port');url=`http://127.0.0.1:${address.port}`;
 return {url,document:read,failure:()=>failure,close:async()=>{await queue;server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));comments.close();}};
}
