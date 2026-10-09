/** The production editor protocol over validated local files. No published head is advanced. */
import {parseDocumentUpdate,type DocumentGraph} from '@artifactbin/contracts';
import {type LoadedArtifact,type EditAnswer,type ArtifactVersionSummary,type ArtifactVersionSnapshot,createDocumentGraph,graphSource,applyGraphPatch,documentAfterOperation} from '../../../app/lib/cli-toolkit';
import type {DocumentMetadata} from '../document';
import type {LocalHistoryEntry} from '../local-history';

interface PreviewEditorDocument {body:string;revision:string;metadata:DocumentMetadata}
interface PreviewEditorFiles {
 read(file:string):Promise<PreviewEditorDocument>;
 version?(file:string,revision:string):Promise<number>;
 history?(file:string):Promise<LocalHistoryEntry[]>;
 write(file:string,revision:string,body:string,metadata:DocumentMetadata):Promise<PreviewEditorDocument>;
}
interface PreviewEditor {
 load(file:string):Promise<LoadedArtifact>;
 versions(file:string):Promise<ArtifactVersionSummary[]>;
 version(file:string,n:number):Promise<ArtifactVersionSnapshot|null>;
 revert(file:string,input:{version:number;expectedVersion:number;expectedState:string}):Promise<EditAnswer>;
 commit(file:string,input:{edit_id:string;document_update:unknown}):Promise<EditAnswer>;
}
/** Instantiated once per session; graph keys survive browser reloads, external edits replace the head. */
export function createPreviewEditor(files:PreviewEditorFiles):PreviewEditor {
 const heads=new Map<string,{revision:string;version:number;graph:DocumentGraph}>();
 const current=async(file:string)=>{
  const doc=await files.read(file);let cached=heads.get(file);
  const version=files.version?await files.version(file,doc.revision):cached?.revision===doc.revision?cached.version:(cached?.version??0)+1;
  if(cached?.revision!==doc.revision||cached.version!==version){cached={revision:doc.revision,version,graph:createDocumentGraph(doc.body,version)};heads.set(file,cached);}
  return {doc,head:cached!};
 };
 const load=async(file:string):Promise<LoadedArtifact>=>{
  const {doc,head}=await current(file);
  return {id:doc.metadata.id??'local-preview',document:head.graph,markup:doc.body,title:doc.metadata.title??null,description:doc.metadata.description??null,theme:doc.metadata.theme??null,template:doc.metadata.template??null,colorMode:doc.metadata.colorMode??null,version:head.version,edit_id:doc.revision,state:doc.revision};
 };
 const history=async(file:string)=>files.history?files.history(file):[];
 return {load,
 async versions(file){return (await history(file)).map(row=>({version:row.version,title:row.metadata.title??null,description:row.metadata.description??null,format:'markup',by:null,created_at:row.at}));},
 async version(file,n){
  const row=(await history(file)).find(item=>item.version===n);if(!row)return null;
  return {version:row.version,format:'markup',html:'',markup:row.body,title:row.metadata.title??null,description:row.metadata.description??null,
   meta:{theme:row.metadata.theme??null,template:row.metadata.template??null,colorMode:row.metadata.colorMode??null}};
 },
 async revert(file,input){
  const {doc,head}=await current(file);
  if(input.expectedVersion!==head.version||input.expectedState!==doc.revision)return {ok:false,status:409,body:{error:'doc_changed',edit_id:doc.revision,version:head.version,markup:doc.body,source:doc.body,document:head.graph}};
  const row=(await history(file)).find(item=>item.version===input.version);
  if(!row)return {ok:false,status:404,body:{error:'version_not_found',edit_id:doc.revision,version:head.version}};
  // Only editable metadata returns from history. Current local identity and publication fences stay current.
  const metadata={...doc.metadata,title:row.metadata.title??null,description:row.metadata.description??null,theme:row.metadata.theme??null,template:row.metadata.template??null,colorMode:row.metadata.colorMode??null};
  const saved=await files.write(file,doc.revision,row.body,metadata);
  const version=files.version?await files.version(file,saved.revision):head.version+1;
  heads.set(file,{revision:saved.revision,version,graph:createDocumentGraph(saved.body,version)});
  return {ok:true,status:200,body:await load(file)};
 },async commit(file,input){
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
  const version=files.version?await files.version(file,saved.revision):head.version+1;
  heads.set(file,{revision:saved.revision,version,graph:saved.body===graphSource(next)?next:createDocumentGraph(saved.body,version)});
  return {ok:true,status:200,body:await load(file)};
 }};
}
