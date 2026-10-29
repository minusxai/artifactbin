import {createHash} from 'node:crypto';
import type {DatasetColumn,DatasetColumnDescriptor,DatasetGraphqlRow,DatasetQueryRequest,DatasetReadRequest} from '@artifactbin/contracts';
import type {DatasetTable} from '@/lib/datasets/types';
import type {DatasetStatement} from './types';
import {columnIdentity,compileDatasetFilters,descriptors,quote,tableIdentity,typedCell} from './model';
/** Named values are resolved before source-column type validation. No page text is compiled as SQL. */
export function parameterizedFilters(input:DatasetQueryRequest):DatasetReadRequest {
 if((input.parameters?.length??0)>32||(input.filters?.length??0)>32)throw new Error('dataset_query_too_complex');
 const parameters=new Map<string,NonNullable<DatasetQueryRequest['parameters']>[number]['value']>();
 for(const parameter of input.parameters??[]){
  if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(parameter.name))throw new Error('dataset_parameter_name');
  if(parameters.has(parameter.name))throw new Error('dataset_parameter_duplicate');parameters.set(parameter.name,parameter.value);
 }
 const used=new Set<string>();
 const filters=input.filters?.map(filter=>{
  if(filter.parameter!==undefined&&filter.value!==undefined)throw new Error('dataset_parameter_ambiguous');
  if(filter.operator==='IS_NULL'&&(filter.parameter!==undefined||filter.value!==undefined))throw new Error('invalid_filter');
  if(filter.parameter===undefined)return {columnId:filter.columnId,operator:filter.operator,...(filter.value===undefined?{}:{value:filter.value})};
  const value=parameters.get(filter.parameter);if(value===undefined)throw new Error('dataset_parameter_missing');used.add(filter.parameter);
  return {columnId:filter.columnId,operator:filter.operator,value};
 });
 if([...parameters.keys()].some(name=>!used.has(name)))throw new Error('dataset_parameter_unused');
 return {tableId:input.tableId,first:input.first,...(input.columnIds===undefined?{}:{columnIds:input.columnIds}),...(input.order===undefined?{}:{order:input.order}),...(input.after===undefined?{}:{after:input.after}),...(filters===undefined?{}:{filters})};
}
export interface DatasetAggregatePlan {statement:DatasetStatement;columns:DatasetColumnDescriptor[];row(row:Record<string,unknown>):DatasetGraphqlRow}
/** Bounded aggregation over the entire authorized source, before output pagination. */
export function compileDatasetQuery(table:DatasetTable,input:DatasetQueryRequest):DatasetAggregatePlan {
 if(!Number.isInteger(input.first)||input.first<1||input.first>100)throw new Error('invalid_page_size');
 if(!input.aggregates?.length||input.aggregates.length>16||(input.groupBy?.length??0)>8||(input.order?.length??0)>16)throw new Error('dataset_query_too_complex');
 if(input.columnIds!==undefined)throw new Error('dataset_aggregate_projection');
 const tableId=tableIdentity(table),source=new Map(table.columns.map(column=>[columnIdentity(tableId,column.name),column])),description=descriptors(table);
 const required=(id:string)=>{const col=source.get(id);if(!col)throw new Error('dataset_column_not_found');return col;};
 const groupIds=input.groupBy??[];if(new Set(groupIds).size!==groupIds.length)throw new Error('dataset_group_duplicate');
 const groups=groupIds.map(required),columns=groupIds.map(id=>description.find(c=>c.id===id)!);
 const selects=groups.map((column,i)=>`${quote(column.name)} AS ${quote(`__af_group_${i}`)}`);
 const values:Array<{alias:string;column:DatasetColumn;id:string}>=groups.map((column,i)=>({column,id:groupIds[i]!,alias:`__af_group_${i}`}));
 const ids=new Set(groupIds);
 for(const [i,aggregate] of input.aggregates.entries()){
  if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(aggregate.id))throw new Error('dataset_aggregate_identity');
  if(ids.has(aggregate.id))throw new Error('dataset_aggregate_duplicate');ids.add(aggregate.id);
  if(!['COUNT','SUM','AVG','MIN','MAX'].includes(aggregate.operation))throw new Error('dataset_aggregate_operation');
  const column=aggregate.columnId===undefined?undefined:required(aggregate.columnId);
  if(aggregate.operation!=='COUNT'&&!column)throw new Error('dataset_aggregate_column');
  if((aggregate.operation==='SUM'||aggregate.operation==='AVG')&&column?.type!=='number')throw new Error('dataset_aggregate_type');
  if((aggregate.operation==='MIN'||aggregate.operation==='MAX')&&column?.type==='boolean')throw new Error('dataset_aggregate_type');
  const output:DatasetColumn=aggregate.operation==='COUNT'||aggregate.operation==='SUM'||aggregate.operation==='AVG'?{name:aggregate.id,type:'number'}:{name:aggregate.id,type:column!.type};
  const type=output.type==='number'?'NUMBER':'STRING';
  columns.push({id:aggregate.id,label:aggregate.id,type,nullable:aggregate.operation!=='COUNT',sourceType:output.type});
  const alias=`__af_metric_${i}`;selects.push(`${aggregate.operation}(${column?quote(column.name):'*'}) AS ${quote(alias)}`);values.push({column:output,id:aggregate.id,alias});
 }
 const {where,params}=compileDatasetFilters(table,parameterizedFilters(input).filters);
 const aliases=new Map(values.map(v=>[v.id,v.alias]));
 const order=(input.order??[]).map(item=>{
  const alias=aliases.get(item.columnId);if(!alias)throw new Error('dataset_column_not_found');if(item.direction!=='ASC'&&item.direction!=='DESC')throw new Error('invalid_order');
  return `${quote(alias)} ${item.direction}`;
 });
 // Unique group tuple is the deterministic final tiebreak, including null groups.
 order.push(...groups.map((_,i)=>`${quote(`__af_group_${i}`)} ASC`));
 const sql=`SELECT ${selects.join(', ')} FROM ${quote(table.schema)}.${quote(table.name)}${where?` WHERE ${where}`:''}${groups.length?` GROUP BY ${groups.map(c=>quote(c.name)).join(', ')}`:''}${order.length?` ORDER BY ${order.join(', ')}`:''}`;
 return {statement:{sql,params},columns,row:row=>({id:`g_${createHash('sha256').update(JSON.stringify([tableId,groupIds,groups.map((_,i)=>row[`__af_group_${i}`]??null)])).digest('base64url')}`,cells:values.map(value=>({columnId:value.id,value:typedCell(value.column,row[value.alias])}))})};
}
