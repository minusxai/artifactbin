import type {DatasetGraphqlReply,HtmlDatasetLink,PageOperationRequest} from '@artifactbin/contracts';
import {parse,getOperationAST,Kind,type SelectionSetNode,type FragmentDefinitionNode} from 'graphql';
import {composePageSchema,executePageOperation} from '../page-operations/namespaces';
import {createDatasetNamespaceInvoker,datasetNamespaceSources} from './namespace';
import {loadLocalDataset,loadLocalTables,type LocalDatasetFile,type LocalDatasetFileOptions} from './local-files';
import {createLocalHasuraDataset} from './local-hasura';
/**
 * Explicit local namespaces; never infer or replace remote ref bindings. `api` is the link's `data-af-api`: like a
 * new published link, a local link without one previews on the generated API (`legacy` keeps the generic namespace).
 */
export interface LocalPreviewDatasetDeclaration {name:string;files:readonly LocalDatasetFile[];api?:'hasura'|'legacy'}
/** The operation's top-level field names (through fragments). */
function rootFields(query:string,operationName?:string):string[]{
 const document=parse(query),operation=getOperationAST(document,operationName);if(!operation)return [];
 const fragments=new Map(document.definitions.filter((node):node is FragmentDefinitionNode=>node.kind===Kind.FRAGMENT_DEFINITION).map(node=>[node.name.value,node]));
 const walk=(set:SelectionSetNode,seen:ReadonlySet<string>):string[]=>set.selections.flatMap(node=>node.kind===Kind.FIELD?[node.name.value]:node.kind===Kind.INLINE_FRAGMENT?walk(node.selectionSet,seen):seen.has(node.name.value)||!fragments.has(node.name.value)?[]:walk(fragments.get(node.name.value)!.selectionSet,new Set([...seen,node.name.value])));
 return walk(operation.selectionSet,new Set());
}
export async function createLocalPreviewDatasets(root:string,declarations:readonly LocalPreviewDatasetDeclaration[],options:LocalDatasetFileOptions={}){
 if(declarations.length>64)throw new Error('local_dataset_too_many_namespaces');
 if(new Set(declarations.map(d=>d.name)).size!==declarations.length)throw new Error('local_dataset_duplicate_namespace');
 const legacy=await Promise.all(declarations.filter(d=>d.api==='legacy').map(async declaration=>{
 const dataset=await loadLocalDataset(root,declaration.name,declaration.files,options);
 const binding:HtmlDatasetLink={kind:'dataset',name:declaration.name,datasetId:`local_${declaration.name}`,mode:'live'};
 return {dataset,binding,invoke:createDatasetNamespaceInvoker(null,[binding],dataset)};
 }));
 const generated=await Promise.all(declarations.filter(d=>d.api!=='legacy').map(async declaration=>({name:declaration.name,dataset:await createLocalHasuraDataset(declaration.name,await loadLocalTables(root,declaration.files,options))})));
 const initialRevisions=await Promise.all(legacy.map(e=>e.dataset.schema(null,e.binding,new AbortController().signal).then(s=>s.revision)));
 const initialGenerated=generated.map(e=>e.dataset.revision());
 const schema=composePageSchema([...datasetNamespaceSources(legacy.map(e=>e.binding)),...generated.map(e=>e.dataset.source)]);
 const datasets={
 queryRoots:()=>Object.assign({},...generated.map(e=>e.dataset.queryRoots())) as Record<string,unknown>,
 async mutate(request:Pick<PageOperationRequest,'query'|'variables'|'operationName'>&{idempotencyKey?:string}):Promise<DatasetGraphqlReply>{
 const fields=rootFields(request.query,request.operationName).filter(field=>field!=='__typename');
 const owners=new Set(generated.filter(e=>fields.some(field=>e.dataset.owns(field))));
 if(owners.size>1)return {errors:[{message:'one mutation writes one dataset; send one mutation per linked dataset',extensions:{code:'one_dataset_per_mutation'}}]};
 const [owner]=[...owners];if(!owner)return {errors:[{message:'no linked dataset has these fields',extensions:{code:'validation_failed'}}]};
 return owner.dataset.mutate({query:request.query,...(request.variables?{variables:request.variables}:{}),...(request.operationName?{operationName:request.operationName}:{}),...(request.idempotencyKey?{idempotencyKey:request.idempotencyKey}:{})});
 },
 };
 return {
 schema,
 /** Local links on the generated API: the page runtime treats their roots as remote fields. */
 datasets:generated.map(e=>e.name),
 async status(){
 const namespaces:string[]=[];
 for(const [i,entry] of legacy.entries()){
 const current=await entry.dataset.schema(null,entry.binding,new AbortController().signal);
 if(current.revision!==initialRevisions[i])namespaces.push(entry.binding.name);
 }
 for(const [i,entry] of generated.entries())if(entry.dataset.revision()!==initialGenerated[i])namespaces.push(entry.name);
 return {dirty:namespaces.length>0,namespaces};
 },
 execute:(request:Pick<PageOperationRequest,'query'|'variables'|'operationName'>&{idempotencyKey?:string},signal:AbortSignal)=>executePageOperation({schema,request,signal,caller:{pageId:'local-preview',subject:null,role:'owner'},datasets:{queryRoots:datasets.queryRoots,mutate:mutation=>datasets.mutate({...mutation,...(request.idempotencyKey?{idempotencyKey:request.idempotencyKey}:{})})},invoke:call=>{
 const entry=legacy.find(e=>e.binding.name===call.namespace);if(!entry)throw new Error('local_dataset_namespace');return entry.invoke(call);
 }}),
 export:(namespace:string)=>{const entry=legacy.find(e=>e.binding.name===namespace);if(entry)return entry.dataset.export();const generatedEntry=generated.find(e=>e.name===namespace);if(!generatedEntry)throw new Error('local_dataset_namespace');return generatedEntry.dataset.export();}
 };
}
