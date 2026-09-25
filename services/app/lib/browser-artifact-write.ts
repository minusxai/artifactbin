import {createDocumentGraph} from './story/document-graph';
/** Controls outside the live editor load an authoring snapshot, validate locally,
 * then submit one permission-scoped JSONB commit. Non-document metadata retains
 * its existing conditional protocol. */
import type {DocumentGraph,DocumentUpdate} from '@artifactbin/contracts';
import {prepareBrowserDocumentUpdate} from './story/document-authoring-client';
export async function writeBrowserArtifact(id:string,change:Record<string,unknown>,editId?:string):Promise<Response>{
 const path=`/api/my/artifacts/${encodeURIComponent(id)}`;
 const observed=await fetch(path);if(!observed.ok)return observed;
 const head=await observed.json() as {document?:DocumentGraph;format?:string;state?:string;version:number;edit_id:string;markup?:string;title?:string|null;description?:string|null;theme?:string|null;template?:string|null;colorMode?:string|null;sharing_revision?:number;ancestor_ids?:string[]};
 if(typeof head.state!=='string'||!Number.isSafeInteger(head.version))return Response.json({error:'invalid_response',details:[{message:'Refresh the artifact before saving.'}]},{status:502});
 const {source,annotationOps,...fields}=change;
 if(source!==undefined&&head.edit_id!==editId)return Response.json({error:'doc_changed',edit_id:head.edit_id,version:head.version,source:head.markup},{status:409});
 if(head.document?.kind==='graph'&&head.format!=='folder'){
  const allowed=new Set(['title','description','theme','template','colorMode','visibility','linkRole','parent_id','shares']);
  if(Object.keys(fields).some(key=>!allowed.has(key)))return Response.json({error:'invalid_metadata',allowed:[...allowed]},{status:400});
  const metadata=Object.fromEntries(Object.entries(fields).filter(([k])=>['title','description','theme','template','colorMode'].includes(k))) as DocumentUpdate['metadata'];
  const update=await prepareBrowserDocumentUpdate(id,{...head,document:head.document,meta:head},{source:source as string|undefined,metadata,annotationOps:annotationOps as DocumentUpdate['annotationOps']});
  const settings=Object.fromEntries(Object.entries(fields).filter(([k])=>['visibility','linkRole','parent_id','shares'].includes(k)).map(([k,v])=>[k==='parent_id'?'parentId':k,v])) as DocumentUpdate['settings'];
  if(Object.keys(settings!).length)Object.assign(update,{settings,expectedSharingRevision:head.sharing_revision??0,expectedParentIds:head.ancestor_ids??[]});
  return fetch(`${path}/edits`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({edit_id:head.edit_id,document_update:update})});
 }
 if(source!==undefined)return Response.json({error:'not_editable'},{status:400});
 return fetch(path,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fields,expectedState:head.state})});
}

/** History keeps the same UX across format changes. Only document restores
 * compile a graph; restoring a native resource keeps its existing protocol. */
export async function restoreBrowserArtifact(id:string,version:number):Promise<Response>{
 const path=`/api/my/artifacts/${encodeURIComponent(id)}`;
 const observed=await fetch(path);if(!observed.ok)return observed;
 const head=await observed.json() as {document?:DocumentGraph;version:number;state:string;edit_id:string;title?:string|null;description?:string|null};
 const archived=await fetch(`${path}/versions/${version}`);if(!archived.ok)return archived;
 const target=await archived.json() as {format:string;markup:string|null;title?:string|null;description?:string|null;meta:{theme?:string|null;template?:string|null;colorMode?:'light'|'dark'|null}};
 if(target.format!=='markup')return fetch(`${path}/revert`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version,expectedVersion:head.version,expectedState:head.state})});
 if(typeof target.markup!=='string')return Response.json({error:'invalid_archived_document'},{status:422});
 const document=head.document?.kind==='graph'?head.document:createDocumentGraph('',head.version);
 const update=await prepareBrowserDocumentUpdate(id,{...head,document,meta:head},{source:target.markup,whole:true,metadata:{title:target.title??null,description:target.description??null,theme:target.meta.theme??null,template:target.meta.template??null,colorMode:target.meta.colorMode??null}});
 return fetch(`${path}/edits`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({edit_id:head.edit_id,document_update:update})});
}
