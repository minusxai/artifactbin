import {POST as revertRoute} from '@/app/api/artifacts/[id]/revert/route';
import {artifactState} from '@/lib/artifacts/state';
import {request} from './harness';
/** Test authoring client: compile before calling the real service/route. Keeping
 * this explicit prevents fixture preparation reads from hiding commit queries. */
import { getArtifactById } from '@/lib/artifacts/rows';
import { type EditInput } from '@/lib/artifacts/store';
import { type ArtifactRow } from '@/lib/artifacts/table';
import {prepareClientDocumentUpdate,type ClientDocumentChange} from '@/lib/document/document-update-client';
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

/** Native restores retain the original artifact/version authority and CAS. */
export async function restoreDocument(token:string,id:string,version:number):Promise<Response>{
 const head=await getArtifactById(id);if(!head)throw new Error('Missing artifact');
 return revertRoute(request(`/api/artifacts/${id}/revert`,{method:'POST',token,json:{version,expectedVersion:head.version,expectedState:artifactState(head)}}),{params:Promise.resolve({id})});
}