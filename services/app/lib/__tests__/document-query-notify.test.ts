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
  const result=await executeDocumentQueries({...flow,queries:[{...query,source:'Dataset01'}]},async()=>({tables:{},catalog}),{actor:{userId:'usr_actual',tokenId:'tok_actual'},refresh:true,now:'2026-01-01T00:00:00.000Z',bindings:{values:{task_id:'usr_saved'},types:{task_id:'user'}}});
  expect(execute).toHaveBeenLastCalledWith(catalog,query.sql,{task_id:'usr_saved',_now:'2026-01-01T00:00:00.000Z'},expect.objectContaining({actor:{userId:'usr_actual',tokenId:'tok_actual'},refresh:true,paramTypes:{task_id:'user',_now:'timestamp'}}));
  expect(result.state.tables.n?.rows[0]?.to).toEqual(['usr_first','usr_second']);expect(result.sourceIds).toEqual(['Dataset01']);
 });
 it('refuses truncated upstream rows before a dependent query can disguise overflow',async()=>{
  execute.mockResolvedValue({columns:[{name:'to',type:'string'},{name:'message',type:'string'}],rows:[{to:'usr_first',message:'Changed'}],truncated:true});
  await expect(executeDocumentQueries({...flow,queries:[{...query,source:'Dataset01'}, {...query,name:'downstream',sql:'select * from n',params:[],reads:{...reads,queries:['n']}}]},async()=>({tables:{},catalog:{kind:'postgres',tables:[]} as unknown as DatasetCatalog}),{completeResults:true})).rejects.toThrow(/complete|truncat|limit/i);
 });
});
it('runs stored catalog models through the existing dataset query implementation',async()=>{
 const actual=await vi.importActual<typeof import('../datasets/execute')>('../datasets/execute');
 const catalog={kind:'stored',defaultSchema:'public',tables:[{schema:'public',name:'model',columns:[{name:'assignee',type:'user'}],sql:"select 'usr_model' as assignee"}]} as unknown as DatasetCatalog;
 execute.mockImplementation(actual.executeCatalog);
 const {state}=await executeDocumentQueries({...flow,queries:[{...query,source:'Stored001',sql:'select assignee as "to", \'Model result\' as message from public.model',params:[]}]},async()=>({tables:{},catalog}),{refresh:true,completeResults:true});
 expect(state.tables.n?.rows).toEqual([{to:'usr_model',message:'Model result'}]);
});
it('refuses a source revoked while a source query runs',async()=>{
 execute.mockImplementation(async(_catalog,_sql,_params,opts)=>{await opts.authorize();return {columns:[],rows:[]};});
 let reads=0;
 await expect(executeDocumentQueries({...flow,queries:[{...query,source:'Gone001'}]},async()=>++reads===1?{tables:{},catalog:{kind:'stored',tables:[]} as unknown as DatasetCatalog}:null,{completeResults:true})).rejects.toThrow(/unavailable/);
});
it('loads source catalogs without materializing imported rows and still rechecks their authority',async()=>{
 execute.mockResolvedValue({columns:query.columns,rows:[]});
 const resolve=vi.fn(async(_ref:string,mode?:string)=>{if(mode==='import')throw new Error('unexpected imported rows');return {tables:{},catalog:{kind:'stored',tables:[]} as unknown as DatasetCatalog};});
 await executeDocumentQueries({...flow,queries:[{...query,source:'Stored001'}]},resolve);
 expect(resolve.mock.calls.map(call=>call[1])).toEqual(['catalog','verify']);
});
it('passes the remaining execution deadline into the source query',async()=>{
 execute.mockResolvedValue({columns:query.columns,rows:[]});
 await executeDocumentQueries({...flow,queries:[{...query,source:'Stored001'}]},async()=>({tables:{},catalog:{kind:'stored',tables:[]} as unknown as DatasetCatalog}),{completeResults:true,timeoutMs:5000});
 expect(execute.mock.lastCall?.[3].timeoutMs).toBeGreaterThan(0);
 expect(execute.mock.lastCall?.[3].timeoutMs).toBeLessThanOrEqual(5000);
});
