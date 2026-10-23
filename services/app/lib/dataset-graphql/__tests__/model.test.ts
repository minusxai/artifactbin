import {describe,it,expect} from 'vitest';
import {tableIdentity,columnIdentity,compileRead,compileChanges,initialRowIds,typedCell} from '../model';
const table={schema:'public',name:'rows',columns:[{name:'label',type:'string' as const},{name:'amount',type:'number' as const},{name:'date',type:'date' as const}],objectKey:'blob'};
const id=tableIdentity(table), column=(name:string)=>columnIdentity(id,name);
describe('dataset GraphQL planning',()=>{
 it('binds filter values and quotes identifiers',()=>{
  const plan=compileRead(table,{tableId:id,first:2,filters:[{columnId:column('label'),operator:'EQ',value:{type:'STRING',value:"a' OR 1=1"}}]});
  expect(plan.statement.sql).not.toContain("a' OR");expect(Object.values(plan.statement.params)).toContain("a' OR 1=1");
 });
 it('keeps native numbers, nulls and date strings',()=>{
  expect(typedCell(table.columns[1]!,3.25)).toEqual({type:'NUMBER',value:3.25});
  expect(typedCell(table.columns[1]!,null)).toEqual({type:'NUMBER',value:null});
  expect(typedCell(table.columns[2]!,'2026-10-23')).toEqual({type:'STRING',value:'2026-10-23'});
 });
 it('allocates reproducible opaque row identities per original object',()=>{
  expect(initialRowIds('dataset',id,'blob',2)).toEqual(initialRowIds('dataset',id,'blob',2));
  expect(initialRowIds('dataset',id,'blob',2)[0]).not.toEqual(initialRowIds('dataset',id,'blob2',2)[0]);
 });
 it('rejects unknown projections and type mismatches',()=>{
  expect(()=>compileRead(table,{tableId:id,first:1,columnIds:['missing']})).toThrow();
  expect(()=>compileChanges(table,[{kind:'INSERT',cells:[{columnId:column('amount'),value:{type:'STRING',value:'3'}}]}])).toThrow();
 });
 it('orders by a hidden stable identity as final tiebreak',()=>{
  expect(compileRead(table,{tableId:id,first:1,order:[{columnId:column('amount'),direction:'DESC'}]}).statement.sql).toContain('"__af_graphql_row_id" ASC');
 });
 it('builds atomic mixed batch statements with identity predicates',()=>{
  const plan=compileChanges(table,[{kind:'INSERT',cells:[{columnId:column('amount'),value:{type:'NUMBER',value:0}}]},{kind:'DELETE',rowId:'row1'}]);
  expect(plan).toHaveLength(2);expect(plan[1]!.params).toEqual({rowId:'row1'});
 });
});
