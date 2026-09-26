/** Gate authoring client. Fixture intent goes through the production compiler;
 * browser traffic is untouched and the server never accepts a text fallback.
 * Gates are plain Node entry points; tsImport loads the shared TypeScript client
 * here without duplicating its compiler or changing the browser under test. */
import {tsImport} from 'tsx/esm/api';
const {prepareClientDocumentPublication}=await tsImport('../../services/app/lib/story/document-update-client.ts',import.meta.url);
const snapshots=new WeakMap();
export async function observeFixtureWrite(raw,input,init={}){
 let seen=snapshots.get(raw);if(!seen){seen=new Map();snapshots.set(raw,seen);}
 const send=async(url,options)=>{
  const response=await raw(url,options);
  if(response.ok){const head=await response.clone().json().catch(()=>null);if(head?.document?.kind==='graph'&&head.edit_id)seen.set(head.edit_id,head);}
  return response;
 };
 const url=new URL(String(input)),method=(init.method??'GET').toUpperCase();
 const target=url.pathname.match(/^\/api\/(?:my\/)?artifacts\/([^/]+)(?:\/(edits|revert))?$/);
 if(!target||!['PUT','PATCH','POST'].includes(method)||typeof init.body!=='string')return send(input,init);
 let body;try{body=JSON.parse(init.body);}catch{return send(input,init);}
 if(!body||Array.isArray(body)||typeof body!=='object'||body.document_update)return send(input,init);
 if(method==='POST'&&!target[2])return send(input,init);
 if(Object.keys(body).every(key=>['edit_id','expectedVersion','expectedState'].includes(key)))return send(input,init);
 const basePath=url.pathname.replace(/\/(edits|revert)$/,''),readUrl=new URL(basePath,url.origin).href;
 let head=body.edit_id?seen.get(body.edit_id):null;
 if(!head){
  const observed=await send(readUrl,{method:'GET',headers:init.headers,redirect:'error'});
  if(!observed.ok)return send(input,init);
  head=await observed.json();
 }
 if(head.document?.kind==='graph'&&!Object.keys(body).some(key=>['dataset','viz','image','pdf','access','policy'].includes(key))){
  if(target[2]==='edits'&&body.edit_id!==head.edit_id)throw new Error('Gate must retain its observed authoring snapshot for a stale edit');
  let source=body.markup??body.source;
  if(typeof body.old_string==='string'){
   if(!head.markup.includes(body.old_string))throw new Error('Gate edit text is absent from its observed snapshot');
   source=head.markup.replace(body.old_string,body.new_string);
  }
  if(target[2]==='revert'){
   const archived=await send(`${readUrl}/versions/${body.version}`,{method:'GET',headers:init.headers});
   if(!archived.ok)return archived;
   const previous=await archived.json();source=previous.markup??previous.source;
  }
  const metadata=Object.fromEntries(Object.entries(body).filter(([key])=>['title','description','theme','template','colorMode'].includes(key)));
  const update=await prepareClientDocumentPublication({...head,meta:head},{source,metadata,whole:method==='PUT'||target[2]==='revert',annotationOps:body.annotation_ops},async context=>{
   const response=await raw(`${readUrl}/prepare`,{method:'POST',headers:init.headers,body:JSON.stringify({source:context})});
   if(!response.ok)throw new Error(`Gate authoring refused: ${await response.text()}`);
   return response.json();
  });
  const settings=Object.fromEntries(Object.entries(body).filter(([key])=>['visibility','linkRole','parent_id','shares'].includes(key)).map(([key,value])=>[key==='parent_id'?'parentId':key,value]));
  if(Object.keys(settings).length)Object.assign(update,{settings,expectedSharingRevision:head.sharing_revision??0,expectedParentIds:head.ancestor_ids??[]});
  if(typeof body.expectedVersion==='number')update.patch.baseVersion=body.expectedVersion;
  return send(`${readUrl}/edits`,{...init,method:'POST',body:JSON.stringify({edit_id:head.edit_id,document_update:update})});
 }
 // Non-document fixtures retain their conditional publication protocol.
 if(target[2]==='edits')return send(input,init);
 return send(input,{...init,body:JSON.stringify({...body,...(method!=='PATCH'&&body.expectedVersion===undefined?{expectedVersion:head.version}:{}),...(body.expectedState===undefined?{expectedState:head.state}:{})})});
}
export const fixtureFetch=(input,init)=>observeFixtureWrite(globalThis.fetch,input,init);
