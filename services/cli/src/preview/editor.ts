/** The production editor protocol over validated local files. No published head is advanced. */
import {parseDocumentUpdate,type DocumentGraph} from '@artifactbin/contracts';
import type {LoadedArtifact,EditAnswer} from '../../../app/lib/artifact-backend/types';
import {createDocumentGraph,graphSource} from '../../../app/lib/story/graph/document-graph';
import {applyGraphPatch} from '../../../app/lib/story/graph/document-graph-patch';
import {documentAfterOperation} from '../../../app/lib/story/graph/document-update-history';
import type {DocumentMetadata} from '../document';

export interface PreviewEditorDocument {body:string;revision:string;metadata:DocumentMetadata}
export interface PreviewEditorFiles {
 read(file:string):Promise<PreviewEditorDocument>;
 write(file:string,revision:string,body:string,metadata:DocumentMetadata):Promise<PreviewEditorDocument>;
}
export interface PreviewEditor {
 load(file:string):Promise<LoadedArtifact>;
 commit(file:string,input:{edit_id:string;document_update:unknown}):Promise<EditAnswer>;
}
/** Instantiated once per session; graph keys survive browser reloads, external edits replace the head. */
export function createPreviewEditor(files:PreviewEditorFiles):PreviewEditor {
 const heads=new Map<string,{revision:string;version:number;graph:DocumentGraph}>();
 const current=async(file:string)=>{
  const doc=await files.read(file);let cached=heads.get(file);
  if(cached?.revision!==doc.revision){cached={revision:doc.revision,version:(cached?.version??0)+1,graph:createDocumentGraph(doc.body,(cached?.version??0)+1)};heads.set(file,cached);}
  return {doc,head:cached!};
 };
 const load=async(file:string):Promise<LoadedArtifact>=>{
  const {doc,head}=await current(file);
  return {id:doc.metadata.id??'local-preview',document:head.graph,markup:doc.body,title:doc.metadata.title??null,theme:doc.metadata.theme??null,template:doc.metadata.template??null,colorMode:doc.metadata.colorMode??null,version:head.version,edit_id:doc.revision};
 };
 return {load,async commit(file,input){
  const {doc,head}=await current(file);
  const conflict=():EditAnswer=>({ok:false,status:409,body:{edit_id:doc.revision,version:head.version,markup:doc.body,source:doc.body,error:'doc_changed',document:head.graph}});
  if(input.edit_id!==doc.revision)return conflict();
  const update=parseDocumentUpdate(input.document_update);
  if(!update)return {ok:false,status:400,body:{edit_id:doc.revision,version:head.version,markup:doc.body,error:'invalid_update'}};
  if(Object.entries(update.expectedMetadata??{}).some(([key,value])=>(doc.metadata[key as keyof DocumentMetadata]??null)!==value))return conflict();
  let next:DocumentGraph|null;
  if(update.whole){
   if(!update.replacement||update.patch.baseVersion!==head.version)return conflict();
   next=documentAfterOperation(head.graph,{kind:'operations',version:head.version+1,forward:update.patch,replacement:update.replacement,beforeNodes:{},beforeRevisions:{},beforeBytes:head.graph.bytes});
  }else next=applyGraphPatch(head.graph,head.version,update.patch);
  if(!next)return conflict();
  const saved=await files.write(file,doc.revision,graphSource(next),{...doc.metadata,...update.metadata});
  const version=head.version+1;
  heads.set(file,{revision:saved.revision,version,graph:saved.body===graphSource(next)?next:createDocumentGraph(saved.body,version)});
  return {ok:true,status:200,body:await load(file)};
 }};
}
