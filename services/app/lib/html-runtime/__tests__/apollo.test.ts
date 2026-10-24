import { describe, expect, it } from 'vitest';
import { createClient, createLocalStore, gql } from '../apollo/client';
import { RemoteUnreachable, type RemotePort } from '../apollo/apollo-contracts';

describe('HTML page client', () => {
  it('keeps viewer documents separate and projects aliased local selections', async () => {
    const first = createClient({ backends: [], state: createLocalStore({ settings: { theme: 'dark', secret: 42 } }) });
    const second = createClient({ backends: [], state: createLocalStore() });
    const query = gql`{ appearance: settings { theme } }`;
    expect((await first.query({ query })).data).toEqual({ appearance: { theme: 'dark' } });
    expect((await second.query({ query })).data).toEqual({ appearance: null });
  });

  it('retries a conflicting local update against the latest viewer state', async () => {
    const state = createLocalStore({ count: 0 });
    const write = state.write;
    let conflict = true;
    state.write = async (change) => {
      if (conflict) { conflict = false; await write({ expected: { count: 0 }, next: { count: 5 } }); }
      return write(change);
    };
    const client = createClient({ backends: [], state });
    expect(await client.updateQuery<{ count: number }>({ query: gql`{ count }` }, ({ count }) => ({ count: count + 1 }))).toEqual({ count: 6 });
  });

  it('relays only backend fields and never persists remote data in local state', async () => {
    const state = createLocalStore({ tab: 'all' });
    const sent: unknown[] = [];
    const remote: RemotePort = { online: () => true, execute: async (request) => {
      sent.push(request);
      return { data: { inventory: { count: 9 } } };
    } };
    const client = createClient({ backends: ['inventory'], state, remote });
    expect((await client.query({ query: gql`{ tab inventory { count } }` })).data).toEqual({ tab: 'all', inventory: { count: 9 } });
    expect(sent).toEqual([{ query: '{\n  inventory {\n    count\n  }\n}', variables: {}, operation: 'query' }]);
    expect(state.read()).toEqual({ tab: 'all' });
  });

  it('does not retry a mutation whose reply was lost; offline sends nothing', async () => {
    let sends = 0;
    const remote: RemotePort = { online: () => true, execute: async () => { sends++; throw new Error('connection lost'); } };
    const client = createClient({ backends: ['inventory'], state: createLocalStore(), remote });
    const mutation = gql`mutation { inventory { reserve } }`;
    expect((await client.mutate({ mutation })).extensions?.outcomes).toEqual({ 'inventory.reserve': 'unknown' });
    expect(sends).toBe(1);
    remote.execute = async () => { throw new RemoteUnreachable(); };
    expect((await client.mutate({ mutation })).extensions?.outcomes).toEqual({ 'inventory.reserve': 'offline' });
    remote.online = () => false;
    remote.execute = async () => { sends++; return { data: null }; };
    await client.mutate({ mutation });
    expect(sends).toBe(1);
  });

  it('watchers follow local fields and settle unavailable backend subscriptions', async () => {
    const client = createClient({ backends: ['inventory'], state: createLocalStore({ count: 0 }) });
    const values: unknown[] = [];
    const subscription = client.watchQuery({ query: gql`{ count }` }).subscribe((result) => values.push(result.data));
    await client.updateQuery({ query: gql`{ count }` }, () => ({ count: 1 }));
    subscription.unsubscribe();
    await client.updateQuery({ query: gql`{ count }` }, () => ({ count: 2 }));
    expect(values).toEqual([{ count: 0 }, { count: 1 }]);
    const remoteResults:any[]=[];const watch=client.watchQuery({query:gql`{inventory{count}}`}).subscribe(result=>remoteResults.push(result));
    for(let i=0;i<6;i++)await Promise.resolve();
    expect(remoteResults.at(-1)).toMatchObject({data:{inventory:null},loading:false,errors:[{message:expect.any(String)}]});watch.unsubscribe();
  });
});

it('adopts newly published backend declarations without replacing private viewer state or the client',async()=>{
 let names:readonly string[]=[];const sent:unknown[]=[];
 const client=createClient({backends:()=>names,state:createLocalStore({filter:'mine'}),remote:{online:()=>true,execute:async request=>{sent.push(request);return {data:{orders:{count:2}}};}}});
 expect((await client.query({query:gql`{ filter orders { count } }`})).data).toEqual({filter:'mine',orders:null});
 names=['orders'];
 expect((await client.query({query:gql`{ filter orders { count } }`})).data).toEqual({filter:'mine',orders:{count:2}});
 expect(sent).toHaveLength(1);
});
it('awaits an already pending query connection once, while offline mutations are never queued',async()=>{
 let connect!:(sender:RemotePort['execute']|null)=>void,sends=0,waits=0;
 const sender:RemotePort['execute']=async()=>{sends++;return {data:{inventory:{count:9}}};};
 const remote:RemotePort={online:()=>false,whenReady(){waits++;return new Promise(resolve=>{connect=resolve;});},execute:sender};
 const client=createClient({backends:['inventory'],state:createLocalStore(),remote});
 const read=client.query({query:gql`{ inventory { count } }`});expect(sends).toBe(0);expect(waits).toBe(1);
 const mutation=await client.mutate({mutation:gql`mutation { inventory { reserve } }`});expect(mutation.extensions?.outcomes).toEqual({'inventory.reserve':'offline'});expect(waits).toBe(1);
 connect(sender);expect((await read).data).toEqual({inventory:{count:9}});expect(sends).toBe(1);
});
it('returns an offline query after connection cancellation without sending it',async()=>{
 let sends=0;const remote:RemotePort={online:()=>false,whenReady:async()=>null,execute:async()=>{sends++;return {data:{}};}};
 const client=createClient({backends:['inventory'],state:createLocalStore(),remote});expect((await client.query({query:gql`{ inventory { count } }`})).errors).toMatchObject([{message:expect.stringContaining('offline')}]);expect(sends).toBe(0);
});
it('preserves an already online remote method receiver',async()=>{
 const remote={count:7,online:()=>true,async execute(this:{count:number}){return {data:{inventory:{count:this.count}}};}};
 const client=createClient({backends:['inventory'],state:createLocalStore(),remote});
 expect((await client.query({query:gql`{ inventory { count } }`})).data).toEqual({inventory:{count:7}});
});
