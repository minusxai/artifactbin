/**
 * Internal: in-memory local dataset sessions for the preview: loads a page's declared local data
 * files, keeps unsaved edits per session (bounded count, size and age) and recovers them when the
 * page file disappears.
 * Used by: preview.mjs, preview-dataset-route.mjs (through the sessions object).
 */
import {randomBytes,createHash} from 'node:crypto';
import {resolve,relative,sep} from 'node:path';
import {previewDatasetLinks} from './preview-html.mjs';
import {readPreviewFile,PreviewLimitError} from './preview-files.mjs';
const DATA_FILE_LIMIT=8*1024*1024,DATA_SESSION_LIMIT=16*1024*1024;
const failure=(status,message)=>Object.assign(Error(message),{status});

/** A bounded, expiring registry. Sessions are capabilities for explicitly declared
 * files from one page/revision; they never acquire account identity or disk writes. */
export function createPreviewSessions(root,{now=Date.now,ttlMs=30*60*1000,maxSessions=4,
  createDatasets}={}){
 const sessions=new Map(),pending=new Map();let sequence=Promise.resolve();
function prune(){for(const [id,session] of sessions)if(session.expires<=now()&&!session.dirty&&
   !session.active)sessions.delete(id);}
function get(id,{allowObsolete=false}={}){prune();const session=sessions.get(id);if(
   !session)throw failure(410,
   'Local dataset session expired; reload the preview. Export session edits before leaving.');if(
   session.obsolete&&!allowObsolete)throw failure(409,
   'Local source revision changed; export old session edits and reload.');session.expires=now(
   )+ttlMs;sessions.delete(id);sessions.set(id,session);return session;}
 async function prepare(source,pathname,revision){
const origin='http://preview.invalid',documentUrl=new URL(pathname,origin),{links,baseHref}=
    previewDatasetLinks(source);
let base;try{base=new URL(baseHref??documentUrl.href,documentUrl);}catch{throw failure(400,
    'Invalid local preview base URL');}
  const grouped=new Map();
  for(const link of links){
   if(!link.href||/^[a-z][a-z0-9+.-]*:/i.test(link.href)||link.href.startsWith('//'))continue;
   const url=new URL(link.href,base);if(url.origin!==origin)continue;
   const path=decodeURIComponent(url.pathname).slice(1),filename=path.split('/').at(-1);
   if(!/\.(csv|json)$/i.test(filename??''))continue;
if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(link.name))throw failure(400,
     'Local dataset namespace must be a GraphQL name');
   const table=link.table??filename.replace(/\.(csv|json)$/i,'');
const files=grouped.get(link.name)??[];files.push({path,table,...(link.schema?{schema:link.schema}:{
     })});grouped.set(link.name,files);
  }
  if(!grouped.size)return undefined;
if(grouped.size>16)throw failure(413,
    'Preview supports at most 16 local dataset namespaces per page.');
  const declarations=[...grouped].map(([name,files])=>({name,files}));
const key=createHash('sha256').update(pathname).update('\0').update(revision).update('\0').update(
    JSON.stringify(declarations)).digest('hex');
  prune();for(const [id,session] of sessions){
if(session.key===key){session.expires=now()+ttlMs;return {id,schema:session.adapter.schema,names:[
     ...session.names]};}
if(session.pathname===pathname&&(session.dirty||session.active)){session.conflict=true;return {id,
     schema:session.adapter.schema,names:[...session.names],conflict:true};}
  }
  if(pending.has(key))return pending.get(key);
  if(pending.size>=4)throw failure(429,'Too many local dataset sessions are loading; retry '+
    'shortly.');
  // Serialize creation so concurrent pages cannot each allocate the full budget.
  const work=sequence.then(async()=>{
   prune();
while(sessions.size>=maxSessions){const disposable=[...sessions].find(([,session])=>!session.dirty&&
     !session.active);if(!disposable)throw failure(429,
     'Local dataset preview is full of unsaved sessions; export and explicitly discard edits '+
     'before opening another page.');sessions.delete(disposable[0]);}
   let bytes=0;
   const admitted=new Map();
   for(const declaration of declarations)for(const file of declaration.files){
const path=resolve(root,file.path),tail=relative(root,path);if(tail==='..'||tail.startsWith(
      '..'+sep))throw failure(400,'Local dataset path is outside preview root');
    const content=await readPreviewFile(root,path,DATA_FILE_LIMIT);bytes+=content.length;
if(bytes>DATA_SESSION_LIMIT)throw new PreviewLimitError(
      'Local dataset session exceeds 16 MiB; use a smaller declared dataset.');
    admitted.set(file.path,content.toString('utf8'));
   }
const moduleUrl=new URL('./preview-datasets.mjs',import.meta.url).href;
     let createLocalPreviewDatasets;
try{createLocalPreviewDatasets=createDatasets??(await import(moduleUrl)).createLocalPreviewDatasets;
     }catch(error){if(error.code==='ERR_MODULE_NOT_FOUND')throw failure(503,
     'Use the downloaded HTTP author skill for bundled local dataset preview.');throw error;}
   // Loader consumes the checked snapshot, not a second unbounded disk read.
const adapter=await createLocalPreviewDatasets(root,declarations,{readText:async path=>{if(
     !admitted.has(path))throw failure(400,'Undeclared local dataset read');return admitted.get(
     path);}});
   const id=randomBytes(18).toString('base64url');

   for(const session of sessions.values())if(session.pathname===pathname)session.obsolete=true;
sessions.set(id,{adapter,key,pathname,expires:now()+ttlMs,names:new Set(grouped.keys()),bytes,
     operations:0,active:0,dirty:false,conflict:false});
   return {id,schema:adapter.schema,names:[...grouped.keys()]};
  });
sequence=work.catch(()=>{});pending.set(key,work);try{return await work;}finally{pending.delete(
    key);}
 }
return {prepare,get,recover(pathname){for(const [id,session] of sessions)if(
   session.pathname===pathname&&session.dirty)return {id,names:[...session.names]};},async status(
   id){const session=get(id,{allowObsolete:true});const status=await session.adapter.status();
   session.dirty=status.dirty;return {...status,conflict:session.conflict,obsolete:
   !!session.obsolete};},discard(id){const session=get(id,{allowObsolete:true});if(
   session.active)throw failure(409,'A local operation is still running; retry before discarding.');
   sessions.delete(id);},close(){sessions.clear();pending.clear();}};
}
