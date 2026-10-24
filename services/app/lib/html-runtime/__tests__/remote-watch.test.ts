import {it,expect} from 'vitest';
import {createClient,createLocalStore,gql} from '../apollo/client';
import type {RemotePort,QueryResult} from '../apollo/apollo-contracts';
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(){let notify=()=>{};const jobs:Array<{resolve:(value:any)=>void;reject:(cause:Error)=>void}>=[],sent:any[]=[];let stops=0;
 const remote:RemotePort={online:()=>true,subscribe(listener){notify=listener;return()=>{stops++;notify=()=>{};};},execute(request){sent.push(request);return new Promise((resolve,reject)=>jobs.push({resolve,reject}));}};
 const state=createLocalStore({filter:'private'}),client=createClient({backends:['records'],state,remote});return {remote,state,client,jobs,sent,notify:()=>notify(),stops:()=>stops};
}
it('actual target client watches only backend fields, separates loading/null/error and suppresses obsolete or disposed completions',async()=>{
 const f=fixture(),seen:QueryResult[]=[];
 const sub=f.client.watchQuery({query:gql`{filter records{value}}`,clearOnRefresh:true}).subscribe(result=>seen.push(result));
 expect(seen.at(-1)).toEqual({data:{filter:'private',records:null},loading:true});expect(f.sent[0].query).not.toContain('filter');
 f.jobs.shift()!.resolve({data:{records:{value:1}}});await tick();expect(seen.at(-1)).toEqual({data:{filter:'private',records:{value:1}},loading:false});
 f.notify();expect(seen.at(-1)?.loading).toBe(true);f.notify();f.jobs.shift()!.resolve({data:{records:{value:'obsolete'}}});await tick();expect(seen.at(-1)?.data.records).toBeNull();
 f.jobs.shift()!.resolve({data:{records:null}});await tick();expect(seen.at(-1)?.loading).toBe(false);expect(seen.at(-1)?.data.records).toBeNull();
 f.notify();f.jobs.shift()!.reject(Error('revoked'));await tick();expect(seen.at(-1)?.loading).toBe(false);expect(seen.at(-1)?.errors?.length).toBe(1);expect(f.state.read()).toEqual({filter:'private'});
 f.notify();const count=seen.length;sub.unsubscribe();expect(f.stops()).toBe(1);f.jobs.shift()!.resolve({data:{records:{value:'late'}}});await tick();expect(seen).toHaveLength(count);
});
it('default watch keeps prior rows during an explicit pending refresh and a committed mutation invalidates without retrying',async()=>{
 const f=fixture(),seen:QueryResult[]=[];const sub=f.client.watchQuery({query:gql`{records{value}}`}).subscribe(result=>seen.push(result));
 f.jobs.shift()!.resolve({data:{records:{value:2}}});await tick();
 const mutation=f.client.mutate({mutation:gql`mutation {records{save}}`});f.jobs.shift()!.resolve({data:{records:{save:true}},extensions:{outcomes:{'records.save':'committed'}}});await mutation;
 expect(seen.at(-1)).toEqual({data:{records:{value:2}},loading:true});expect(f.sent.filter(r=>r.operation==='mutation')).toHaveLength(1);
 f.jobs.shift()!.resolve({data:{records:{value:3}}});await tick();expect(seen.at(-1)?.loading).toBe(false);sub.unsubscribe();
});
