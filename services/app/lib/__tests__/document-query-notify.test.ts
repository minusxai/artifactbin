import {describe,it,expect,vi} from 'vitest';
import {executeDocumentQueries} from '../sql/document-queries';
import type {CompiledDataflow} from '../story/compiled-dataflow';
import type {DatasetCatalog} from '../datasets/types';
const execute=vi.hoisted(()=>vi.fn());
vi.mock('../datasets/execute',()=>({executeCatalog:execute}));
const reads={imports:[],queries:[],values:[],builtins:[]};
const query={name:'n',engine:'sqlite' as const,sql:'select $task_id as "to", $_now as message',params:['task_id','_now'],reads,columns:[{name:'to',type:'user' as const},{name:'message',type:'string' as const}],start:0,end:1};
const flow:CompiledDataflow={imports:[],values:[],queries:[query],mutations:[]};
describe('shared document query execution for notifications',()=>{
 it('uses saved arguments and the original clock without page Values',async()=>{
  const {state}=await executeDocumentQueries(flow,async()=>null,{now:'2026-01-01T00:00:00.000Z',bindings:{values:{task_id:'usr_saved'},types:{task_id:'user'}}});
  expect(state.errors).toEqual({});expect(state.tables.n?.rows).toEqual([{to:'usr_saved',message:'2026-01-01T00:00:00.000Z'}]);
 });
 it.each(['stored','postgres'] as const)('uses dataset execution and fresh reads for %s sources',async kind=>{
  execute.mockResolvedValue({columns:[{name:'to',type:'string'},{name:'message',type:'string'}],rows:[{to:['usr_first','usr_second'],message:'Changed'}]});
  const catalog={kind,defaultSchema:'public',tables:[]} as unknown as DatasetCatalog;
  const result=await executeDocumentQueries({...flow,queries:[{...query,source:'Dataset01'}]},async()=>({tables:{},catalog}),{refresh:true,now:'2026-01-01T00:00:00.000Z',bindings:{values:{task_id:'usr_saved'},types:{task_id:'user'}}});
  expect(execute).toHaveBeenLastCalledWith(catalog,query.sql,{task_id:'usr_saved',_now:'2026-01-01T00:00:00.000Z'},expect.objectContaining({refresh:true,paramTypes:{task_id:'user',_now:'timestamp'}}));
  expect(result.state.tables.n?.rows[0]?.to).toEqual(['usr_first','usr_second']);expect(result.sourceIds).toEqual(['Dataset01']);
 });
 it('refuses truncated upstream rows before a dependent query can disguise overflow',async()=>{
  execute.mockResolvedValue({columns:[{name:'to',type:'string'},{name:'message',type:'string'}],rows:[{to:'usr_first',message:'Changed'}],truncated:true});
  await expect(executeDocumentQueries({...flow,queries:[{...query,source:'Dataset01'}, {...query,name:'downstream',sql:'select * from n',params:[],reads:{...reads,queries:['n']}}]},async()=>({tables:{},catalog:{kind:'postgres',tables:[]} as unknown as DatasetCatalog}),{completeResults:true})).rejects.toThrow(/complete|truncat|limit/i);
 });
});
