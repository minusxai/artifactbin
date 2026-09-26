import type {DocumentAssetWarning} from '@artifactbin/contracts';
import type {ArtifactBackend} from '@/lib/artifact-backend/types';
/** Browser transport for authoring inputs; ordinary prose and attribute edits
 * do not call it. The document itself is committed only by /edits. */
import {prepareClientDocumentPublication,type ClientDocumentSnapshot,type ClientDocumentChange} from './document-update-client';
export async function prepareBrowserDocumentUpdate(backend:Pick<ArtifactBackend,'prepare'>,base:ClientDocumentSnapshot,change:ClientDocumentChange,onWarnings?:(warnings:DocumentAssetWarning[])=>void){
 return prepareClientDocumentPublication(base,change,source=>backend.prepare(source),onWarnings);
}
