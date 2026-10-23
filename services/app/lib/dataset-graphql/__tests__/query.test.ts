import {expect,it} from 'vitest';
import {compileDatasetQuery,parameterizedFilters} from '../query';
import {tableIdentity,columnIdentity} from '../model';
const table={schema:'public',name:'rows',columns:[{name:'label',type:'string' as const},{name:'amount',type:'number' as const}]};
const tableId=tableIdentity(table),column=(name:string)=>columnIdentity(tableId,name);
it('binds named parameters without interpolating values into aggregate SQL',()=>{
 const plan=compileDatasetQuery(table,{tableId,first:10,filters:[{columnId:column('label'),operator:'EQ',parameter:'label'}],parameters:[{name:'label',value:{type:'STRING',value:"x' OR 1=1"}}],aggregates:[{id:'total',operation:'SUM',columnId:column('amount')},{id:'count',operation:'COUNT'}]});
 expect(plan.statement.sql).not.toContain("x' OR");expect(Object.values(plan.statement.params)).toContain("x' OR 1=1");expect(plan.statement.sql).toContain('SUM(');expect(plan.statement.sql).toContain('COUNT(*)');
});
it('rejects missing, duplicate and unused parameter bindings',()=>{
 const filters=[{columnId:column('amount'),operator:'GT' as const,parameter:'minimum'}];
 expect(()=>parameterizedFilters({tableId,first:1,filters})).toThrow('dataset_parameter_missing');
 const parameter={name:'minimum',value:{type:'NUMBER' as const,value:1}};
 expect(()=>parameterizedFilters({tableId,first:1,filters,parameters:[parameter,parameter]})).toThrow('dataset_parameter_duplicate');
 expect(()=>parameterizedFilters({tableId,first:1,parameters:[parameter]})).toThrow('dataset_parameter_unused');
 expect(()=>parameterizedFilters({tableId,first:1,filters:[{...filters[0]!,value:{type:'NUMBER',value:1}}],parameters:[parameter]})).toThrow('dataset_parameter_ambiguous');
});
it('bounds grouping and metrics and rejects invalid aggregate types',()=>{
 expect(()=>compileDatasetQuery(table,{tableId,first:101,aggregates:[{id:'count',operation:'COUNT'}]})).toThrow('invalid_page_size');
 expect(()=>compileDatasetQuery(table,{tableId,first:1,aggregates:[{id:'total',operation:'SUM',columnId:column('label')}]})).toThrow('dataset_aggregate_type');
 expect(()=>compileDatasetQuery(table,{tableId,first:1,aggregates:[{id:'count',operation:'COUNT'},{id:'count',operation:'COUNT'}]})).toThrow('dataset_aggregate_duplicate');
 expect(()=>compileDatasetQuery(table,{tableId,first:1,aggregates:[{id:'count',operation:'COUNT'}],groupBy:Array(9).fill(column('label'))})).toThrow('dataset_query_too_complex');
});
it('preserves group nulls and gives groups stable IDs across changed totals',()=>{
 const plan=compileDatasetQuery(table,{tableId,first:1,groupBy:[column('label')],aggregates:[{id:'total',operation:'SUM',columnId:column('amount')}]}),row=plan.row({__af_group_0:null,__af_metric_0:2.5}),updated=plan.row({__af_group_0:null,__af_metric_0:7});
 expect(row.id).toBe(updated.id);expect(row.cells.map(c=>c.value.value)).toEqual([null,2.5]);expect(row.cells[1]!.value.type).toBe('NUMBER');
});
