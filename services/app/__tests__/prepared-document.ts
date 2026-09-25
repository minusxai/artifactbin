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
