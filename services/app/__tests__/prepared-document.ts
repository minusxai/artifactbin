import {GET as archiveRoute} from '@/app/api/artifacts/[id]/versions/[version]/route';
import {POST as operationRoute} from '@/app/api/artifacts/[id]/edits/route';
import {request} from './harness';
/** Test authoring client: compile before calling the real service/route. Keeping
 * this explicit prevents fixture preparation reads from hiding commit queries. */
import {getArtifactById,type ArtifactRow,type EditInput} from '@/lib/artifacts';
import {prepareDocumentAuthoringContext} from '@/lib/story/document-authoring-context';
import {prepareClientDocumentUpdate,prepareClientDocumentPublication,type ClientDocumentChange} from '@/lib/story/document-update-client';
export function documentEdit(row:ArtifactRow,change:ClientDocumentChange):EditInput {
 if(row.document?.kind!=='graph')throw new Error('Read the authoring snapshot before editing');
 return {baseEditId:row.edit_id,documentUpdate:prepareClientDocumentUpdate({...row,document:row.document},change)};
}
export function documentEditBody(row:ArtifactRow,change:ClientDocumentChange){
 const prepared=documentEdit(row,change);
 return {edit_id:prepared.baseEditId,document_update:prepared.documentUpdate!};
}

/** Fixture counterpart of the browser controls: request intent becomes a
 * prepared operation before it reaches the real route. No server fallback. */
export function documentPublicationBody(row:ArtifactRow,body:Record<string,unknown>,whole=false){
 const metadata=Object.fromEntries(Object.entries(body).filter(([key])=>['title','description','theme','template','colorMode','access','folder'].includes(key)));
 const prepared=documentEditBody(row,{source:(body.markup??body.source) as string|undefined,metadata,whole,annotationOps:(body.annotationOps??body.annotation_ops) as ClientDocumentChange['annotationOps']});
 const settings=Object.fromEntries(Object.entries(body).filter(([key])=>['visibility','linkRole','parent_id','shares'].includes(key)).map(([key,value])=>[key==='parent_id'?'parentId':key,value]));
 if(Object.keys(settings).length)Object.assign(prepared.document_update,{settings,expectedSharingRevision:row.sharing_revision,expectedParentIds:row.ancestor_ids});
 if(typeof body.expectedVersion==='number')prepared.document_update.patch.baseVersion=body.expectedVersion;
 return prepared;
}

/** A fresh client read for tests that do not exercise stale authoring bases. */
export async function observedTextBody(id:string,oldText:string,newText:string){
 const row=await getArtifactById(id);if(!row?.source)throw new Error('Missing authoring source');
 if(row.source.split(oldText).length!==2)throw new Error('Text edit needs one exact match');
 return documentEditBody(row,{source:row.source.replace(oldText,newText)});
}
export async function observedSourceBody(id:string,source:string){
 const row=await getArtifactById(id);if(!row)throw new Error('Missing authoring snapshot');
 return documentEditBody(row,{source});
}

/** Resource-bearing fixtures use the same preparation stage as browser/CLI. */
export async function documentPublicationWithResources(row:ArtifactRow,body:Record<string,unknown>,whole=false){
 const prepared=documentPublicationBody(row,body,whole);
 if(row.document?.kind!=='graph')throw new Error('Missing authoring graph');
 const update=await prepareClientDocumentPublication({...row,document:row.document},{source:(body.markup??body.source) as string|undefined,metadata:prepared.document_update.metadata,whole,annotationOps:prepared.document_update.annotationOps},async source=>{
  const response=await prepareDocumentAuthoringContext({tokenId:row.token_id,userId:row.user_id},row.id,{source});
  if(!response.ok)throw new Error(await response.text());
  return response.json();
 });
 update.patch.baseVersion=prepared.document_update.patch.baseVersion;
 return {...prepared,document_update:{...update,...(prepared.document_update.settings?{settings:prepared.document_update.settings,expectedSharingRevision:prepared.document_update.expectedSharingRevision,expectedParentIds:prepared.document_update.expectedParentIds}:{})}};
}

/** Restore is a client read of an archive followed by a prepared whole edit. */
export async function restoreDocument(token:string,id:string,version:number):Promise<Response>{
 const archive=await archiveRoute(request(`/api/artifacts/${id}/versions/${version}`,{token}),{params:Promise.resolve({id,version:String(version)})});
 if(!archive.ok)return archive;
 const target=await archive.json(),head=await getArtifactById(id);if(!head)throw new Error('Missing authoring snapshot');
 const body=await documentPublicationWithResources(head,{source:target.markup,title:target.title??null,description:target.description??null,theme:target.meta?.theme??null,template:target.meta?.template??null,colorMode:target.meta?.colorMode??null},true);
 return operationRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token,json:body}),{params:Promise.resolve({id})});
}
