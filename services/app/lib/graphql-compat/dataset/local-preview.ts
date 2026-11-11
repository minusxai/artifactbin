/** DEPRECATED: GraphQL compatibility for pages published before SQL. Do not use in new code; do not extend. */
import type {DatasetGraphqlReply,PageOperationRequest} from '@artifactbin/contracts';
import {parse,getOperationAST,Kind,type SelectionSetNode,type FragmentDefinitionNode} from 'graphql';
import {composePageSchema,executePageOperation} from '../../page-operations/namespaces';
import {loadLocalTables,type LocalDatasetFile,type LocalDatasetFileOptions} from '../../dataset-access/local-files';
import {createLocalHasuraDataset} from './local-hasura';
import {runLocalSql} from '../../dataset-access/local-sql';
/** Explicit local dataset links, each previewed on its generated API; never infer or replace remote ref bindings. */
export interface LocalPreviewDatasetDeclaration {name:string;files:readonly LocalDatasetFile[]}
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
 const generated=await Promise.all(declarations.map(async declaration=>({name:declaration.name,dataset:await createLocalHasuraDataset(declaration.name,await loadLocalTables(root,declaration.files,options))})));
 const initialGenerated=generated.map(e=>e.dataset.revision());
 const schema=composePageSchema(generated.map(e=>e.dataset.source));
 const datasets={
 queryRoots:()=>Object.assign({},...generated.map(e=>e.dataset.queryRoots())) as Record<string,unknown>,
 async mutate(request:Pick<PageOperationRequest,'query'|'variables'|'operationName'>&{idempotencyKey?:string}):Promise<DatasetGraphqlReply>{
 const fields=rootFields(request.query,request.operationName).filter(field=>field!=='__typename');
 const owners=new Set(generated.filter(e=>fields.some(field=>e.dataset.owns(field))));
 if(owners.size>1)return {errors:[{message:'one mutation writes one dataset; send one mutation per linked dataset',extensions:{code:'one_dataset_per_mutation'}}]};
 const [owner]=[...owners];if(!owner)return {errors:[{message:'no linked dataset has these fields',extensions:{code:'validation_failed'}}]};
 return owner.dataset.mutate({query:request.query,...(request.variables?{variables:request.variables}:{}),...(request.operationName?{operationName:request.operationName}:{}),...(request.idempotencyKey?{idempotencyKey:request.idempotencyKey}:{})});
 },
 // The page's `_sql` over this session's current rows (./local-sql: the hosted engine's answer is authoritative).
 sql:(call:{sql:string;params:Readonly<Record<string,import('@artifactbin/contracts').Scalar>>})=>runLocalSql(generated.flatMap(entry=>{const {tables}=entry.dataset.export();return tables.map(t=>({link:entry.name,table:tables.length===1?null:t.name,columns:t.columns,rows:t.rows,rowIds:t.rowIds??[]}));}),call.sql,call.params),
 };
 return {
 schema,
 /** The local links: the page runtime treats their roots as remote fields. */
 datasets:generated.map(e=>e.name),
 async status(){
 const namespaces:string[]=[];
 for(const [i,entry] of generated.entries())if(entry.dataset.revision()!==initialGenerated[i])namespaces.push(entry.name);
 return {dirty:namespaces.length>0,namespaces};
 },
 execute:(request:Pick<PageOperationRequest,'query'|'variables'|'operationName'>&{idempotencyKey?:string},signal:AbortSignal)=>executePageOperation({schema,request,signal,caller:{pageId:'local-preview',subject:null,role:'owner'},canEdit:async()=>true,datasets:{queryRoots:datasets.queryRoots,sql:datasets.sql,mutate:mutation=>datasets.mutate({...mutation,...(request.idempotencyKey?{idempotencyKey:request.idempotencyKey}:{})})}}),
 export:(namespace:string)=>{const generatedEntry=generated.find(e=>e.name===namespace);if(!generatedEntry)throw new Error('local_dataset_namespace');return generatedEntry.dataset.export();}
 };
}
