import type {HtmlDatasetLink,PageOperationRequest} from '@artifactbin/contracts';
import {composePageSchema,executePageOperation} from '../page-operations/namespaces';
import {createDatasetNamespaceInvoker,datasetNamespaceSources} from './namespace';
import {loadLocalDataset,type LocalDatasetFile,type LocalDatasetFileOptions} from './local-files';
/** Explicit local namespaces; never infer or replace remote ref bindings. */
export interface LocalPreviewDatasetDeclaration {name:string;files:readonly LocalDatasetFile[]}
export async function createLocalPreviewDatasets(root:string,declarations:readonly LocalPreviewDatasetDeclaration[],options:LocalDatasetFileOptions={}){
 if(declarations.length>64)throw new Error('local_dataset_too_many_namespaces');
 if(new Set(declarations.map(d=>d.name)).size!==declarations.length)throw new Error('local_dataset_duplicate_namespace');
 const entries=await Promise.all(declarations.map(async declaration=>{
 const dataset=await loadLocalDataset(root,declaration.name,declaration.files,options);
 const binding:HtmlDatasetLink={kind:'dataset',name:declaration.name,datasetId:`local_${declaration.name}`,mode:'live'};
 return {dataset,binding,invoke:createDatasetNamespaceInvoker(null,[binding],dataset)};
 }));
 const schema=composePageSchema(datasetNamespaceSources(entries.map(e=>e.binding)));
 return {
 schema,
 execute:(request:Pick<PageOperationRequest,'query'|'variables'|'operationName'>,signal:AbortSignal)=>executePageOperation({schema,request,signal,caller:{pageId:'local-preview',subject:null,role:'OWNER'},invoke:call=>{
 const entry=entries.find(e=>e.binding.name===call.namespace);if(!entry)throw new Error('local_dataset_namespace');return entry.invoke(call);
 }}),
 export:(namespace:string)=>{const entry=entries.find(e=>e.binding.name===namespace);if(!entry)throw new Error('local_dataset_namespace');return entry.dataset.export();}
 };
}
