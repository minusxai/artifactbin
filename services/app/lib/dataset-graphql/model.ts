import {createHash,randomUUID} from 'node:crypto';
import type { DatasetCellValue,DatasetColumn,DatasetColumnDescriptor,DatasetReadRequest,DatasetRowFilter,DatasetRowChange,Scalar } from '@artifactbin/contracts';
import type {DatasetTable} from '@/lib/datasets';
import type {DatasetStatement,DatasetRowIdentitySidecar} from './types';
export const ID_COLUMN='__af_graphql_row_id';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('base64url');
export const tableIdentity=(table:Pick<DatasetTable,'schema'|'name'>)=>`t_${digest([table.schema,table.name])}`;
export const columnIdentity=(tableId:string,name:string)=>`c_${digest([tableId,name])}`;
export const initialRowIds=(datasetId:string,tableId:string,objectKey:string,count:number)=>Array.from({length:count},(_,i)=>`r_${digest([datasetId,tableId,objectKey,i])}`);
/** A changed content pointer is a replacement; a matching corrupt sidecar must never reset identities silently. */
export function rowIdsForObject(datasetId:string,tableId:string,objectKey:string,count:number,prior:unknown):readonly string[]{
 if(prior===undefined)return initialRowIds(datasetId,tableId,objectKey,count);
 if(!prior||typeof prior!=='object'||typeof (prior as DatasetRowIdentitySidecar).objectKey!=='string')throw new Error('dataset_row_identity_corrupt');
 const saved=prior as DatasetRowIdentitySidecar;
 if(saved.objectKey!==objectKey)return initialRowIds(datasetId,tableId,objectKey,count);
 if(!Array.isArray(saved.ids)||saved.ids.length!==count||new Set(saved.ids).size!==count||saved.ids.some(id=>typeof id!=='string'||!id))throw new Error('dataset_row_identity_corrupt');
 return saved.ids;
}

export const quote=(name:string)=>`"${name.replaceAll('"','""')}"`;
const cellType=(column:DatasetColumn):DatasetCellValue['type']=>column.type==='number'?'NUMBER':column.type==='boolean'?'BOOLEAN':'STRING';
export function descriptors(table:DatasetTable):DatasetColumnDescriptor[]{
 if(table.columns.some(c=>c.name===ID_COLUMN))throw new Error('dataset_reserved_column');
 return table.columns.map(c=>({id:columnIdentity(tableIdentity(table),c.name),label:c.name,type:cellType(c),nullable:true,sourceType:c.type}));
}
export function typedCell(column:DatasetColumn,value:unknown):DatasetCellValue {
 const type=cellType(column);
 if(value===null||value===undefined)return {type,value:null} as DatasetCellValue;
 if(type==='NUMBER'&&typeof value==='number'&&Number.isFinite(value))return {type,value};
 if(type==='BOOLEAN'&&typeof value==='boolean')return {type,value};
 if(type==='STRING'&&typeof value==='string')return {type,value};
 throw new Error('dataset_cell_type_mismatch');
}
function columnsFor(table:DatasetTable){
 if(table.columns.some(c=>c.name===ID_COLUMN))throw new Error('dataset_reserved_column');
 return new Map(table.columns.map(c=>[columnIdentity(tableIdentity(table),c.name),c]));
}
function requireColumn(columns:Map<string,DatasetColumn>,id:string){const c=columns.get(id);if(!c)throw new Error('dataset_column_not_found');return c;}
function scalar(column:DatasetColumn,cell:DatasetCellValue):Scalar {
 if(cell.type!==cellType(column))throw new Error('dataset_cell_type_mismatch');
 return typedCell(column,cell.value).value as Scalar;
}
export function compileDatasetFilters(table:DatasetTable,filters:readonly DatasetRowFilter[]|undefined):{where:string;params:Record<string,Scalar>}{
 if((filters?.length??0)>32)throw new Error('dataset_query_too_complex');
 const columns=columnsFor(table);
 const params:Record<string,Scalar>={};
 const where=(filters??[]).map((filter,i)=>{
  const col=requireColumn(columns,filter.columnId),q=quote(col.name);
  if(filter.operator==='IS_NULL')return `${q} IS NULL`;
  const operators={EQ:'=',NE:'<>',LT:'<',LTE:'<=',GT:'>',GTE:'>='} as const;
  const op=operators[filter.operator];if(!op||!filter.value)throw new Error('invalid_filter');
  const value=scalar(col,filter.value);if(value===null){if(filter.operator!=='EQ'&&filter.operator!=='NE')throw new Error('invalid_null_filter');return `${q} IS ${filter.operator==='NE'?'NOT ':''}NULL`;}
  const key=`filter${i}`;params[key]=value;return `${q} ${op} $${key}`;
 });
 return {where:where.join(' AND '),params};
}
export function compileRead(table:DatasetTable,input:DatasetReadRequest):{statement:DatasetStatement;columns:DatasetColumn[]} {
 if(!Number.isInteger(input.first)||input.first<1||input.first>100)throw new Error('invalid_page_size');
 const columns=columnsFor(table), selected=input.columnIds?.map(id=>requireColumn(columns,id))??table.columns;
 if(new Set(selected).size!==selected.length||!selected.length)throw new Error('invalid_projection');
 if((input.filters?.length??0)>32||(input.order?.length??0)>16)throw new Error('dataset_query_too_complex');
 const {where,params}=compileDatasetFilters(table,input.filters);
 const order=(input.order??[]).map(o=>{if(o.direction!=='ASC'&&o.direction!=='DESC')throw new Error('invalid_order');return `${quote(requireColumn(columns,o.columnId).name)} ${o.direction}`;});
 order.push(`${quote(ID_COLUMN)} ASC`);
 return {columns:selected,statement:{sql:`SELECT ${[...selected.map(c=>quote(c.name)),quote(ID_COLUMN)].join(', ')} FROM ${quote(table.schema)}.${quote(table.name)}${where?` WHERE ${where}`:''} ORDER BY ${order.join(', ')}`,params}};
}
export function compileChanges(table:DatasetTable,changes:readonly DatasetRowChange[],identitySeed?:string):DatasetStatement[]{
 if(!changes.length||changes.length>100)throw new Error('invalid_changes');
 const columns=columnsFor(table),target=`${quote(table.schema)}.${quote(table.name)}`;
 return changes.map((change,index)=>{
  const params:Record<string,Scalar>={};
  if(change.kind==='DELETE'){if(!change.rowId)throw new Error('invalid_row_id');return {sql:`DELETE FROM ${target} WHERE ${quote(ID_COLUMN)} = $rowId`,params:{rowId:change.rowId}};}
  if(change.kind!=='INSERT'&&change.kind!=='UPDATE')throw new Error('invalid_change');
  const names=change.cells.map((cell,i)=>{const column=requireColumn(columns,cell.columnId);params[`cell${i}`]=scalar(column,cell.value);return column.name;});
  if(new Set(names).size!==names.length||!names.length)throw new Error('invalid_cells');
  if(change.kind==='INSERT'){
   params.rowId=identitySeed?`r_${digest([identitySeed,index])}`:`r_${randomUUID()}`;
   return {sql:`INSERT INTO ${target} (${[...names,ID_COLUMN].map(quote).join(', ')}) VALUES (${[...names.map((_,i)=>`$cell${i}`),'$rowId'].join(', ')})`,params};
  }
  if(!change.rowId)throw new Error('invalid_row_id');
  params.rowId=change.rowId;
  return {sql:`UPDATE ${target} SET ${names.map((name,i)=>`${quote(name)} = $cell${i}`).join(', ')} WHERE ${quote(ID_COLUMN)} = $rowId`,params};
 });
}
