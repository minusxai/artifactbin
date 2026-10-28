import {expect,it,vi} from 'vitest';
import {createDatasetGraphql} from '../index';
import {createDatasetNamespaceInvoker} from '../namespace';
import type {DatasetGraphqlPort,DatasetSnapshot} from '../types';
const actor={userId:'usr_viewer',tokenId:null,email:null,documentEditor:false};
const binding={kind:'dataset' as const,name:'bookings',datasetId:'dataset',mode:'live' as const};
const signal=new AbortController().signal;
const snapshot:DatasetSnapshot={id:'dataset',revision:'1',policyIdentity:'policy',catalog:{kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[]},rowIds:{}};
function setup(){
 const people=vi.fn(async()=>[{id:'usr_known',name:'Known',handle:'known',image:null}]);
 const port:DatasetGraphqlPort={snapshot:vi.fn(async()=>snapshot),execute:vi.fn(),commit:vi.fn(),people};
 return {port,people,api:createDatasetGraphql(port)};
}
it('requires fresh dataset authorization before asking for actual person cards',async()=>{
 const {api,port,people}=setup();
 expect(await api.people(actor,binding,['usr_known'],signal)).toEqual([{id:'usr_known',name:'Known',handle:'known',image:null}]);
 expect(people).toHaveBeenCalledWith(actor,snapshot,['usr_known'],signal);
 port.snapshot=async()=>{throw Error('denied');};
 await expect(api.people(actor,binding,['usr_known'],signal)).rejects.toThrow('denied');
 expect(people).toHaveBeenCalledTimes(1);
});
it('rejects unbounded or malformed person requests before doing dataset or account reads',async()=>{
 const {api,port}=setup();
 for(const ids of [Array.from({length:101},(_,i)=>'usr_'+i),['private-email@example.com']])await expect(api.people(actor,binding,ids,signal)).rejects.toThrow('invalid_people');
 expect(port.snapshot).not.toHaveBeenCalled();
});
it('routes read-only lookup through the admitted dataset namespace',async()=>{
 const {api,people}=setup();
 const invoke=createDatasetNamespaceInvoker(actor,[binding],api);
 const call={namespace:'bookings',fileId:'dataset',version:'live',field:'people',operation:'query' as const,args:{ids:['usr_known']},signal};
 expect(await invoke(call as never)).toEqual([{id:'usr_known',name:'Known',handle:'known',image:null}]);
 await expect(invoke({...call,operation:'mutation'} as never)).rejects.toThrow('dataset_field_not_found');
 await expect(invoke({...call,fileId:'unlinked'} as never)).rejects.toThrow('dataset_binding_changed');
 expect(people).toHaveBeenCalledTimes(1);
});

it('looks up only actual references in typed user columns, excluding plain text and missing accounts',async()=>{
 const {readDatasetPeople}=await import('../people');
 const current={...snapshot,catalog:{...snapshot.catalog,tables:[{schema:'public',name:'rows',objectKey:'rows',columns:[{name:'booked_by',type:'user' as const},{name:'note',type:'string' as const}]}]}};
 const cards=vi.fn(async()=>({usr_known:{name:'Actual name',handle:'actual',image:null}}));
 const result=await readDatasetPeople(current,['usr_known','usr_note','usr_absent','usr_deleted'],{rows:async()=>[{booked_by:'usr_known',note:'usr_note'},{booked_by:'usr_deleted'}],cards,verify:async()=>{}},signal);
 expect(cards).toHaveBeenCalledWith(['usr_known','usr_deleted']);
 expect(result).toEqual([{id:'usr_known',name:'Actual name',handle:'actual',image:null}]);
});
it('withholds cards when dataset access changes while actual account data loads',async()=>{
 const {readDatasetPeople}=await import('../people');
 const current={...snapshot,catalog:{...snapshot.catalog,tables:[{schema:'public',name:'rows',objectKey:'rows',columns:[{name:'person',type:'user' as const}]}]}};
 let allowed=true;
 await expect(readDatasetPeople(current,['usr_known'],{rows:async()=>[{person:'usr_known'}],cards:async()=>{allowed=false;return {usr_known:{name:'Actual',handle:null,image:null}};},verify:async()=>{if(!allowed)throw Error('revoked');}},signal)).rejects.toThrow('revoked');
});
