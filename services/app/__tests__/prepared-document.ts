/** Test authoring client: compile before calling the real service/route. Keeping
 * this explicit prevents fixture preparation reads from hiding commit queries. */
import type {ArtifactRow,EditInput} from '@/lib/artifacts';
import {prepareClientDocumentUpdate,type ClientDocumentChange} from '@/lib/story/document-update-client';
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
 const metadata=Object.fromEntries(Object.entries(body).filter(([key])=>['title','description','theme','template','colorMode'].includes(key)));
 const prepared=documentEditBody(row,{source:(body.markup??body.source) as string|undefined,metadata,whole,annotationOps:(body.annotationOps??body.annotation_ops) as ClientDocumentChange['annotationOps']});
 const settings=Object.fromEntries(Object.entries(body).filter(([key])=>['visibility','linkRole','parent_id','shares'].includes(key)).map(([key,value])=>[key==='parent_id'?'parentId':key,value]));
 if(Object.keys(settings).length)Object.assign(prepared.document_update,{settings,expectedSharingRevision:row.sharing_revision,expectedParentIds:row.ancestor_ids});
 if(typeof body.expectedVersion==='number')prepared.document_update.patch.baseVersion=body.expectedVersion;
 return prepared;
}
