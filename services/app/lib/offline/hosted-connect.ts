/** Offline authoring uses the same guarded graph patch as the live editor. The baseline comes from an authenticated historical read, never from the offered HTML. */
import type {DocumentUpdate,DocumentResourcePreparation} from '@artifactbin/contracts';
import {graphSource, prepareClientDocument, attachAuthoringContext, type ClientDocumentSnapshot} from '../document';
import type {ArtifactFile} from './file-format';

export function prepareHostedFileUpdate(file:ArtifactFile,base:ClientDocumentSnapshot & {markup:string}):DocumentUpdate {
 return preparedHostedFile(file,base).update;
}
export function prepareHostedFilePublication(file:ArtifactFile,base:ClientDocumentSnapshot & {markup:string},prepareContext:(source:string)=>Promise<DocumentResourcePreparation|void>):Promise<DocumentUpdate>{
 return attachAuthoringContext(preparedHostedFile(file,base),prepareContext);
}
function preparedHostedFile(file:ArtifactFile,base:ClientDocumentSnapshot & {markup:string}){
 if(file.base.version!==base.version||file.base.source!==base.markup||graphSource(base.document)!==base.markup)throw Error('The offline baseline cannot be verified against the original document. Keep this file and use an independent copy.');
 const metadata:NonNullable<DocumentUpdate['metadata']>={};
 for(const key of ['title','description','theme','template','colorMode'] as const){
  const original=key==='title'?base.title??null:key==='description'?base.description??null:base.meta[key]??null;
  if(file.metadata[key]!==original)Object.assign(metadata,{[key]:file.metadata[key]});
 }
 return prepareClientDocument(base,{source:file.source,metadata});
}
