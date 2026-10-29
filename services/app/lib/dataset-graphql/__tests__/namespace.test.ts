import {expect,it,vi} from 'vitest';
import {createDatasetNamespaceInvoker,datasetNamespaceSources} from '../index';
import type {DatasetGraphql,PageResolverFieldCall} from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
const actor:AccessActor={userId:'viewer',tokenId:null,email:null,documentEditor:false};
const binding={kind:'dataset' as const,name:'data',datasetId:'dataset',mode:'live' as const};
const call:PageResolverFieldCall={namespace:'data',fileId:'dataset',version:'live',operation:'query',field:'rows',args:{tableId:'table',first:2},principal:{tenant:'tenant',subject:'untrusted-page'},signal:new AbortController().signal};
it('uses constant schema and trusted actor with typed wire outputs',async()=>{
 const read=vi.fn().mockResolvedValue({revision:'1',columns:[],rows:[{id:'row',cells:[{columnId:'column',value:{type:'NUMBER',value:2.5}}]}],pageInfo:{hasNextPage:false,endCursor:null}});
 const service={people:vi.fn(),schema:vi.fn(),query:vi.fn(),read,write:vi.fn()} as DatasetGraphql<AccessActor>,invoke=createDatasetNamespaceInvoker(actor,[binding],service);
 expect(datasetNamespaceSources([binding])[0]).toMatchObject({name:'data',fileId:'dataset',version:'live'});
 expect(await invoke(call)).toMatchObject({rows:[{cells:[{value:{type:'NUMBER',number:2.5}}]}]});
 expect(read.mock.calls[0]![0]).toBe(actor);
 await expect(invoke({...call,fileId:'other'})).rejects.toThrow('dataset_binding_changed');
});
it('rejects mixed wire slots before mutation and preserves unknown outcomes',async()=>{
 const write=vi.fn().mockResolvedValue({requestId:'req',outcome:'unknown',revision:null,rowIds:[]});
 const invoke=createDatasetNamespaceInvoker(actor,[binding],{people:vi.fn(),schema:vi.fn(),query:vi.fn(),read:vi.fn(),write});
 const mutation={...call,operation:'mutation' as const,field:'writeRows',args:{tableId:'table',expectedRevision:'1',requestId:'req',changes:[{kind:'INSERT',cells:[{columnId:'column',value:{type:'NUMBER',number:3}}]}]}};
 const reportOutcome=vi.fn(),reportedMutation={...mutation,reportOutcome};
 expect(await invoke(reportedMutation)).toMatchObject({outcome:'unknown'});expect(reportOutcome).toHaveBeenCalledWith('unknown');
 await expect(invoke({...mutation,args:{...mutation.args,changes:[{kind:'INSERT',cells:[{columnId:'column',value:{type:'NUMBER',number:3,string:'bad'}}]}]}})).rejects.toThrow('invalid_dataset_cell');
 expect(write).toHaveBeenCalledTimes(1);
});
