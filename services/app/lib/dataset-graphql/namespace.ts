import {DATASET_GRAPHQL_SDL,datasetCellFromWire,type DatasetCellValue,type DatasetGraphql,type DatasetReadRequest,type DatasetQueryRequest,type DatasetRowChange,type DatasetWriteRequest,type HtmlDatasetLink,type HtmlJson,type PageNamespaceSource,type PageResolverFieldCall} from '@artifactbin/contracts';
export const datasetNamespaceSources=(bindings:readonly HtmlDatasetLink[]):PageNamespaceSource[]=>bindings.map(binding=>({name:binding.name,fileId:binding.datasetId,version:binding.mode==='pinned'?binding.revision:'live',typeDefs:DATASET_GRAPHQL_SDL}));
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_dataset_input');return value as Record<string,unknown>;};
const string=(value:unknown)=>{if(typeof value!=='string'||!value)throw new Error('invalid_dataset_input');return value;};
const array=(value:unknown)=>{if(!Array.isArray(value))throw new Error('invalid_dataset_input');return value as unknown[];};
const cell=(value:unknown)=>{const parsed=datasetCellFromWire(object(value) as unknown as Parameters<typeof datasetCellFromWire>[0]);if(!parsed)throw new Error('invalid_dataset_cell');return parsed;};
const cells=(value:unknown)=>array(value).map(value=>{const c=object(value);return {columnId:string(c.columnId),value:cell(c.value)};});
function wire(value:DatasetCellValue){const slot={STRING:'string',NUMBER:'number',BOOLEAN:'boolean',JSON:'json'}[value.type];return {type:value.type,[slot]:value.value};}
/** Actor comes from the trusted HTTP resolver, never from resolver principal data or page arguments. */
export function createDatasetNamespaceInvoker<A>(actor:A,bindings:readonly HtmlDatasetLink[],service:DatasetGraphql<A>){
 return async(call:PageResolverFieldCall):Promise<HtmlJson>=>{
  const binding=bindings.find(b=>b.name===call.namespace);
  if(!binding||binding.datasetId!==call.fileId||(binding.mode==='pinned'?binding.revision:'live')!==call.version)throw new Error('dataset_binding_changed');
  const args=object(call.args);
  if(call.operation==='query'&&call.field==='schema')return await service.schema(actor,binding,call.signal) as unknown as HtmlJson;
  if(call.operation==='query'&&(call.field==='rows'||call.field==='query')){
   const input:DatasetQueryRequest={tableId:string(args.tableId),first:args.first===undefined?20:Number(args.first),
    ...(args.columnIds==null?{}:{columnIds:array(args.columnIds).map(string)}),...(args.after==null?{}:{after:string(args.after)}),
    ...(args.filters==null?{}:{filters:array(args.filters).map(v=>{const filter=object(v);if(!['EQ','NE','LT','LTE','GT','GTE','IS_NULL'].includes(String(filter.operator)))throw new Error('invalid_dataset_filter');return {columnId:string(filter.columnId),operator:filter.operator as 'EQ',...(filter.value==null?{}:{value:cell(filter.value)}),...(filter.parameter==null?{}:{parameter:string(filter.parameter)})};})}),
    ...(args.order==null?{}:{order:array(args.order).map(v=>{const order=object(v);if(order.direction!=='ASC'&&order.direction!=='DESC')throw new Error('invalid_dataset_order');return {columnId:string(order.columnId),direction:order.direction};})})};
   if(call.field==='query'){
    if(args.parameters!=null)input.parameters=array(args.parameters).map(v=>{const parameter=object(v);return {name:string(parameter.name),value:cell(parameter.value)};});
    if(args.groupBy!=null)input.groupBy=array(args.groupBy).map(string);
    if(args.aggregates!=null)input.aggregates=array(args.aggregates).map(v=>{const aggregate=object(v);if(!['COUNT','SUM','AVG','MIN','MAX'].includes(String(aggregate.operation)))throw new Error('invalid_dataset_aggregate');return {id:string(aggregate.id),operation:aggregate.operation as 'COUNT',...(aggregate.columnId==null?{}:{columnId:string(aggregate.columnId)})};});
   }
   const result=await (call.field==='query'?service.query(actor,binding,input,call.signal):service.read(actor,binding,input as DatasetReadRequest,call.signal));
   return {...result,rows:result.rows.map(row=>({...row,cells:row.cells.map(c=>({...c,value:wire(c.value)}))}))} as unknown as HtmlJson;
  }
  if(call.operation==='mutation'&&call.field==='writeRows'){
   const changes:DatasetRowChange[]=array(args.changes).map(v=>{const change=object(v);if(change.kind==='INSERT')return {kind:'INSERT',cells:cells(change.cells)};if(change.kind==='UPDATE')return {kind:'UPDATE',rowId:string(change.rowId),cells:cells(change.cells)};if(change.kind==='DELETE')return {kind:'DELETE',rowId:string(change.rowId)};throw new Error('invalid_dataset_change');});
   const input:DatasetWriteRequest={tableId:string(args.tableId),expectedRevision:string(args.expectedRevision),requestId:string(args.requestId),changes};
   const receipt=await service.write(actor,binding,input,call.signal);
   call.reportOutcome?.(receipt.outcome);
   return receipt as unknown as HtmlJson;
  }
  throw new Error('dataset_field_not_found');
 };
}
