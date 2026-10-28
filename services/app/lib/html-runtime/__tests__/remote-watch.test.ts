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
it('committed mutations still resolve and refresh other watches when one observer and its cleanup throw',async()=>{
 let subscriptions=0,reads=0,stops=0,failObserver=false;
 const remote:RemotePort={online:()=>true,subscribe(){const index=++subscriptions;return()=>{stops++;if(index===1)throw Error('cleanup failed');};},async execute(request):ReturnType<RemotePort['execute']>{if(request.operation==='mutation')return {data:{records:{save:true}},extensions:{outcomes:{'records.save':'committed'}}};reads++;return {data:{records:{value:reads}}};}};
 const client=createClient({backends:['records'],state:createLocalStore(),remote}),seen:QueryResult[]=[];
 const broken=client.watchQuery({query:gql`{records{value}}`}).subscribe(result=>{if(failObserver&&result.loading)throw Error('view removed');});
 const healthy=client.watchQuery({query:gql`{records{value}}`}).subscribe(result=>seen.push(result));await tick();failObserver=true;
 await expect(client.mutate({mutation:gql`mutation {records{save}}`})).resolves.toMatchObject({data:{records:{save:true}},extensions:{outcomes:{'records.save':'committed'}}});
 await tick();expect(reads).toBe(3);expect(seen.at(-1)?.loading).toBe(false);expect(stops).toBe(1);
 broken.unsubscribe();healthy.unsubscribe();expect(stops).toBe(2);
});
it('synchronous remote invalidation during subscription releases an observer that throws and its eventual cleanup',async()=>{
 let stops=0,reads=0;
 const remote:RemotePort={online:()=>true,subscribe(listener){listener();return()=>{stops++;};},async execute(){reads++;return {data:{records:{value:1}}};}};
 const client=createClient({backends:['records'],state:createLocalStore(),remote});
 for(let i=0;i<20;i++){
  const subscription=client.watchQuery({query:gql`{records{value}}`,clearOnRefresh:true}).subscribe(()=>{throw Error('view failed');});
  subscription.unsubscribe();
 }
 await tick();expect(stops).toBe(20);expect(reads).toBe(0);
});
it('a synchronous state notification that closes setup cleans state without acquiring a remote listener',()=>{
 let stops=0,remoteSubscriptions=0;
 const state=createLocalStore({filter:'old'});
 state.subscribe=listener=>{listener({filter:'new'});return()=>{stops++;};};
 const remote:RemotePort={online:()=>true,subscribe(){remoteSubscriptions++;return()=>{};},async execute(){throw Error('closed watcher must not read');}};
 const client=createClient({backends:['records'],state,remote});
 const sub=client.watchQuery({query:gql`{filter records{value}}`}).subscribe(()=>{throw Error('view failed');});
 sub.unsubscribe();expect(stops).toBe(1);expect(remoteSubscriptions).toBe(0);
});

it('retains protected rows and viewer only for same-session data refresh and clears before authority reread',async()=>{
 const f=fixture(),seen:QueryResult[]=[];
 const sub=f.client.watchQuery({query:gql`{records{value}}`,clearOnRefresh:true,preserveOnDataRefresh:true}).subscribe(result=>seen.push(result));
 f.jobs.shift()!.resolve({data:{records:{value:'owner rows'}}});await tick();
 const mutation=f.client.mutate({mutation:gql`mutation {records{save}}`});
 f.jobs.shift()!.resolve({data:{records:{save:true}},extensions:{outcomes:{'records.save':'committed'}}});await mutation;
 expect(seen.at(-1)).toEqual({data:{records:{value:'owner rows'}},loading:true});
 // An authority invalidation fences the already-running data read before it can restore old rows.
 f.notify();expect(seen.at(-1)).toEqual({data:{records:null},loading:true});
 f.jobs.shift()!.resolve({data:{records:{value:'stale owner'}}});await tick();
 expect(seen.at(-1)?.data.records).toBeNull();
 f.jobs.shift()!.resolve({data:{records:{value:'new subject'}}});await tick();
 expect(seen.at(-1)).toEqual({data:{records:{value:'new subject'}},loading:false});sub.unsubscribe();
});

it('a page can watch every query a registered program admits, plus its viewer, and the cap still bounds runaway watches',()=>{
 const remote:RemotePort={online:()=>true,subscribe(){return()=>{};},async execute(){return {data:{records:{value:1}}};}};
 const client=createClient({backends:['records'],state:createLocalStore(),remote});
 const watch=()=>client.watchQuery({query:gql`{records{value}}`,clearOnRefresh:true,preserveOnDataRefresh:true}).subscribe(()=>{});
 // 64 registered queries and the viewer: a migrated page's controller holds all of them at once.
 const subscriptions=Array.from({length:65},watch);
 let refused:unknown;
 for(let i=0;i<1000&&!refused;i++){try{subscriptions.push(watch());}catch(error){refused=error;}}
 expect(String(refused)).toContain('Too many remote query subscriptions');
 subscriptions.pop()!.unsubscribe();
 const again=watch();
 again.unsubscribe();for(const subscription of subscriptions)subscription.unsubscribe();
});
