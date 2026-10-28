import { createSqliteSql } from "@artifactbin/sql/sqlite";
import { it, expect } from "vitest";
import {QUERY_LIMITS} from "../contracts";
import { createRegisteredPageQueries } from "../service";
import type {
  QueryPlan,
  QueryPorts,
  QueryContext,
  QueryRequest,
} from "../contracts";
const validRequest: QueryRequest = { values: {}, only: ["total"] };
const context: QueryContext = {
  pageId: "page",
  pageVersion: 1,
  backendId: "backend",
  backendVersion: "one",
  sourceSha256: "a".repeat(64),
  subject: null,
};
const plan: QueryPlan = {
  registration: context,
  scalars: { amount: { type: "number", default: null } },
  imports: [],
  queries: [
    { name: "total", sql: "select $amount as amount", dependencies: [] },
  ],
};
function fixture() {
  const calls: string[] = [];
  const ports: QueryPorts = {
    registry: async () => structuredClone(plan),
    authorize: async () => true,
    platform: async () => ({
      userId: null,
      now: "2026-01-02T00:00:00Z",
      tz: "UTC",
    }),
    source: async () => {
      throw Error("unexpected");
    },
    execute: (input) => {
      calls.push(...input.queries.map((q) => q.name));
      return {
        result: Promise.resolve(
          Object.fromEntries(
            input.queries.map((q) => [
              q.name,
              {
                columns: [{ name: "amount", type: "number" }],
                rows: [{ amount: input.params.amount }],
              },
            ]),
          ),
        ),
        cancelAndDrain: async () => {
          calls.push("drained");
        },
      };
    },
  };
  return {
    ports,
    calls,
    run: (input: unknown) =>
      createRegisteredPageQueries(ports).execute(context, input),
  };
}
it("uses declared defaults and refuses SQL, builtin or binding overrides", async () => {
  const f = fixture();
  expect((await f.run(validRequest)).total).toMatchObject({
    rows: [{ amount: null }],
  });
  for (const request of [
    { values: { _now: "x" }, only: ["total"] },
    { values: { amount: "3" }, only: ["total"] },
    { values: {}, only: ["total"], sql: "select 1" },
  ])
    await expect(f.run(request)).rejects.toThrow();
});
it("orders derived queries and returns only requested tables", async () => {
  const f = fixture();
  f.ports.registry = async () => ({
    ...plan,
    queries: [
      { name: "total", sql: "select * from first", dependencies: ["first"] },
      { name: "first", sql: "select 1", dependencies: [] },
    ],
  });
  await f.run(validRequest);
  expect(f.calls).toEqual(["first", "total"]);
});
it("rejects cycles and saved source drift before SQL", async () => {
  const f = fixture();
  f.ports.registry = async () => ({
    ...plan,
    registration: { ...context, sourceSha256: "b".repeat(64) },
  });
  await expect(f.run(validRequest)).rejects.toThrow(
    "query_registration_changed",
  );
  expect(f.calls).toEqual([]);
  f.ports.registry = async () => ({
    ...plan,
    queries: [{ ...plan.queries[0]!, dependencies: ["total"] }],
  });
  await expect(f.run(validRequest)).rejects.toThrow("invalid_query_registry");
});
it("materializes all windows and refuses a revision or authority change", async () => {
  const f = fixture();
  let pages = 0,
    verified = false;
  f.ports.registry = async () => ({
    ...plan,
    imports: [{ alias: "items", binding: "server-binding", table: "rows" }],
  });
  f.ports.source = async () => ({
    read: async (offset) => {
      pages++;
      return {
        revision: "1",
        authority: "grant",
        columns: [{ name: "amount", type: "number" }],
        rows: [{ amount: offset }],
        nextOffset: offset === 0 ? 1 : null,
      };
    },
    verify: async () => {
      verified = true;
    },
  });
  await f.run(validRequest);
  expect(pages).toBe(2);
  expect(verified).toBe(true);
  f.ports.source = async () => ({
    read: async (offset) => ({
      revision: String(offset),
      authority: "grant",
      columns: [],
      rows: [{}],
      nextOffset: offset === 0 ? 1 : null,
    }),
    verify: async () => {},
  });
  await expect(f.run(validRequest)).rejects.toThrow("dataset_changed");
});
it("withholds results if post-execution authorization is lost", async () => {
  const f = fixture();
  let count = 0;
  f.ports.authorize = async () => ++count === 1;
  await expect(f.run(validRequest)).rejects.toThrow("denied");
});
it("cancels and drains SQL before returning cancellation", async () => {
  const f = fixture(),
    abort = new AbortController();
  let finish!: () => void,
    drained = false;
  f.ports.execute = () => ({
    result: new Promise(() => {}),
    cancelAndDrain: async () => {
      await new Promise<void>((r) => {
        finish = r;
      });
      drained = true;
    },
  });
  let started!: () => void;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  const execute = f.ports.execute;
  f.ports.execute = (...args) => {
    started();
    return execute(...args);
  };
  const result = createRegisteredPageQueries(f.ports).execute(
    context,
    { values: {}, only: ["total"] },
    abort.signal,
  );
  await ready;
  abort.abort(Error("stop"));
  await Promise.resolve();
  expect(drained).toBe(false);
  finish();
  await expect(result).rejects.toThrow("stop");
  expect(drained).toBe(true);
});

it("runs real host SQLite date, JSON, nullable values, viewer and derived relations", async () => {
  const f = fixture();
  const sql = createSqliteSql();
  f.ports.registry = async () => ({
    ...plan,
    queries: [
      {
        name: "base",
        sql: "select $amount as amount, $_now as instant, (select id from _me) as viewer",
        dependencies: [],
      },
      {
        name: "total",
        sql: "select coalesce(amount, 7) as amount, date(instant) as day, json_group_array(viewer) as people from base",
        dependencies: ["base"],
      },
    ],
  });
  f.ports.execute = (input) => ({
    result: sql.run(input),
    cancelAndDrain: async () => {},
  });
  const answer = await f.run({ values: { amount: null }, only: ["total"] });
  expect(answer).toMatchObject({
    total: { rows: [{ amount: 7, day: "2026-01-02", people: "[null]" }] },
  });
  expect(Object.keys(answer)).toEqual(["total"]);
});
it("refuses truncated SQL results rather than returning a partial chart", async () => {
  const f = fixture();
  f.ports.execute = () => ({
    result: Promise.resolve({
      total: { columns: [], rows: [], truncated: true },
    }),
    cancelAndDrain: async () => {},
  });
  await expect(f.run(validRequest)).rejects.toThrow("invalid_query_output");
});

it("refuses over-limit materialization before SQL and checks live-source postfences", async () => {
  const f = fixture();
  f.ports.registry = async () => ({
    ...plan,
    imports: [{ alias: "items", binding: "document-reach", table: "rows" }],
  });
  f.ports.source = async () => ({
    read: async (offset) => ({
      revision: "one",
      authority: "viewer",
      columns: [{ name: "amount", type: "number" }],
      rows: Array.from({ length: 500 }, () => ({ amount: 1 })),
      nextOffset: offset + 500,
    }),
    verify: async () => {},
  });
  await expect(f.run(validRequest)).rejects.toThrow("query_input_limit");
  expect(f.calls).toEqual([]);
  f.ports.source = async () => ({
    read: async () => ({
      revision: "one",
      authority: "viewer",
      columns: [],
      rows: [],
      nextOffset: null,
    }),
    verify: async () => {
      throw Error("policy_changed");
    },
  });
  await expect(f.run(validRequest)).rejects.toThrow("policy_changed");
});
it("uses one platform snapshot per invocation and keeps request/registry untouched", async () => {
  const f = fixture(),
    original = structuredClone(plan),
    request = structuredClone(validRequest);
  let clocks = 0;
  f.ports.platform = async () => {
    clocks++;
    return { userId: null, now: "2026-01-02T00:00:00Z", tz: "UTC" };
  };
  await f.run(request);
  expect(clocks).toBe(1);
  expect(plan).toEqual(original);
  expect(request).toEqual(validRequest);
});

it("expires the injected deadline and drains before releasing invocation resources", async () => {
  const f = fixture();
  let expire!: () => void,
    cleared = false,
    drained = false,
    started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.ports.execute = () => {
    started();
    return {
      result: new Promise(() => {}),
      cancelAndDrain: async () => {
        drained = true;
      },
    };
  };
  const run = createRegisteredPageQueries(f.ports, {
    scheduleDeadline: (_ms, callback) => {
      expire = callback;
      return () => {
        cleared = true;
      };
    },
  }).execute(context, validRequest);
  await ready;
  expire();
  await expect(run).rejects.toThrow("query_deadline");
  expect(drained).toBe(true);
  expect(cleared).toBe(true);
});
it("keeps query failures distinct from empty table results", async () => {
  const f = fixture();
  f.ports.execute = () => ({
    result: Promise.resolve({ total: { error: "synthetic SQL failure" } }),
    cancelAndDrain: async () => {},
  });
  expect(await f.run(validRequest)).toEqual({
    total: { error: "synthetic SQL failure" },
  });
});

it("snapshots caller values before waiting for registry I/O", async () => {
  const f = fixture(),
    request: QueryRequest = { values: { amount: 2 }, only: ["total"] };
  let release!: (plan: QueryPlan) => void;
  f.ports.registry = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const run = f.run(request);
  request.values.amount = 9;
  release(structuredClone(plan));
  expect(await run).toMatchObject({ total: { rows: [{ amount: 2 }] } });
});

it('exposes only the authenticated target viewer identity through the readonly registered namespace',async()=>{
 const {registeredQueryInvoker,registeredViewerDescriptor}=await import('../namespace');
 const page={pageId:'page',version:1,revision:'1',html:'',nextNodeId:1,links:[]};
 const context={pageId:'page',pageVersion:1,backendId:'backend',backendVersion:'one',sourceSha256:'a'.repeat(64),subject:'target-viewer'};
 let evaluated=false;
 const invoke=registeredQueryInvoker(page,context,async()=>{evaluated=true;return {};});
 const call={operation:'query' as const,field:'viewer',principal:{tenant:'page',subject:'target-viewer'},fileId:'backend',version:'one',args:{id:'forged-source-user'},signal:new AbortController().signal,namespace:'queries'};
 expect(await invoke(call)).toEqual({id:'target-viewer'});expect(evaluated).toBe(false);
 expect(await registeredQueryInvoker(page,{...context,subject:null},async()=>({}))({...call,principal:{tenant:'page',subject:null}})).toEqual({id:null});
 await expect(invoke({...call,operation:'mutation'})).rejects.toThrow('registered_query_unavailable');
 await expect(invoke({...call,principal:{tenant:'page',subject:'forged'}})).rejects.toThrow('registered_query_unavailable');
 expect(registeredViewerDescriptor('queries')).toMatchObject({namespace:'queries',identity:'target-subject-v1',responsePath:['queries','viewer','id']});
});
it('a failed evaluation reaches the page as a field error with its sanitized reason as the code, never its detail',async()=>{
 const {registeredQueryInvoker}=await import('../namespace');
 const page={pageId:'page',version:1,revision:'1',html:'',nextNodeId:1,links:[]};
 const context={pageId:'page',pageVersion:1,backendId:'backend',backendVersion:'one',sourceSha256:'a'.repeat(64),subject:null};
 const call={operation:'query' as const,field:'evaluate',principal:{tenant:'page',subject:null},fileId:'backend',version:'one',args:{only:['total']},signal:new AbortController().signal,namespace:'queries'};
 await expect(registeredQueryInvoker(page,context,async()=>{throw Error('sql_read_rejected');})(call)).rejects.toMatchObject({name:'FieldFailed',code:'sql_read_rejected'});
 const failed=await registeredQueryInvoker(page,context,async()=>{throw Error('connection to 10.0.0.1 refused');})(call).catch(error=>error);
 expect(failed).toMatchObject({name:'FieldFailed',code:'registered_query_failed'});expect(failed.detail).toBeUndefined();
});
it('executes immutable source queries inside their catalog without materializing large base tables',async()=>{
 const f=fixture(),checks:string[]=[];
 f.ports.registry=async()=>({...plan,queries:[{name:'total',sql:'select count(*) as amount from public.rows where amount >= $amount',source:'connectedDataset',dependencies:[]}]});
 f.ports.catalog=async(_context,id)=>{expect(id).toBe('connectedDataset');return {verify:async()=>{checks.push('verified');},execute:async(sql,params,types)=>{expect(sql).toBe('select count(*) as amount from public.rows where amount >= $amount');expect(params.amount).toBe(3);expect(types.amount).toBe('number');return {columns:[{name:'amount',type:'number'}],rows:[{amount:250000}]};}};};
 expect(await f.run({values:{amount:3},only:['total']})).toMatchObject({total:{rows:[{amount:250000}]}});
 expect(f.calls).toEqual([]);expect(checks.length).toBeGreaterThanOrEqual(2);
});
it('makes bounded catalog results available to local derived queries and retains catalog revocation fences',async()=>{
 const f=fixture(),sql=createSqliteSql();let revoked=false;
 f.ports.registry=async()=>({...plan,queries:[{name:'base',sql:'select count(*) as amount from public.rows',source:'connectedDataset',dependencies:[]},{name:'total',sql:'select amount*2 as amount from base',dependencies:['base']}]});
 f.ports.catalog=async()=>({verify:async()=>{if(revoked)throw Error('catalog_revoked');},execute:async()=>({columns:[{name:'amount',type:'number'}],rows:[{amount:250000}]})});
 f.ports.execute=input=>({result:sql.run(input),cancelAndDrain:async()=>{}});
 expect(await f.run(validRequest)).toMatchObject({total:{rows:[{amount:500000}]}});
 const execute=f.ports.execute;f.ports.execute=(...args)=>{revoked=true;return execute(...args);};
 await expect(f.run(validRequest)).rejects.toThrow('catalog_revoked');
});
it('refuses unavailable catalog ports, truncated catalog results and source query dependency ambiguity',async()=>{
 const f=fixture();const connected={...plan,queries:[{name:'total',sql:'select amount from public.rows',source:'connectedDataset',dependencies:[]}]};
 f.ports.registry=async()=>connected;
 await expect(f.run(validRequest)).rejects.toThrow('query_source_unsupported');
 f.ports.catalog=async()=>({verify:async()=>{},execute:async()=>({columns:[],rows:[],truncated:true})});
 await expect(f.run(validRequest)).rejects.toThrow('invalid_query_output');
 f.ports.registry=async()=>({...connected,queries:[{...connected.queries[0]!,dependencies:['total']}]});
 await expect(f.run(validRequest)).rejects.toThrow('invalid_query_registry');
});
it('drains direct catalog work before returning cancellation',async()=>{
 const f=fixture(),abort=new AbortController();let finish!:()=>void,started!:()=>void,settled=false;
 const ready=new Promise<void>(r=>{started=r;});
 f.ports.registry=async()=>({...plan,queries:[{name:'total',sql:'select count(*) as amount from public.rows',source:'connectedDataset',dependencies:[]}]});
 f.ports.catalog=async()=>({verify:async()=>{},execute:async()=>{started();await new Promise<void>(r=>{finish=r;});settled=true;return {columns:[],rows:[]};}});
 const run=createRegisteredPageQueries(f.ports).execute(context,validRequest,abort.signal);await ready;abort.abort(Error('stop_catalog'));
 await Promise.resolve();expect(settled).toBe(false);finish();await expect(run).rejects.toThrow('stop_catalog');expect(settled).toBe(true);
});

it("queries immutable saved local tables with scalar filters and dependencies without accepting replacement rows", async()=>{
 const f=fixture(),sql=createSqliteSql();
 f.ports.registry=async()=>({...plan,localTables:[{name:'items',columns:[{name:'amount',type:'number'},{name:'label',type:'string'}],rows:[{amount:2,label:null},{amount:5,label:'kept'}]}],queries:[{name:'filtered',sql:'select amount from items where amount >= $amount',dependencies:[]},{name:'total',sql:'select sum(amount) as amount from filtered',dependencies:['filtered']}]});
 f.ports.execute=input=>({result:sql.run(input),cancelAndDrain:async()=>{}});
 expect(await f.run({values:{amount:3},only:['total']})).toMatchObject({total:{rows:[{amount:5}]}});
 await expect(f.run({values:{},only:['total'],localTables:[]})).rejects.toThrow('invalid_query_request');
 await expect(f.run({values:{items:[]},only:['total']})).rejects.toThrow('invalid_query_request');
});
it('accepts authored local column labels and preserves them through quoted SQL execution',async()=>{
 const f=fixture(),sql=createSqliteSql(),label='Lowest in';
 f.ports.registry=async()=>({...plan,localTables:[{name:'rank',columns:[{name:label,type:'string'},{name:'x\"); DROP TABLE rank; --',type:'number'}],rows:[{[label]:'period',[ 'x\"); DROP TABLE rank; --']:7}]}],queries:[{name:'total',sql:'select "Lowest in", "x""); DROP TABLE rank; --" from rank',dependencies:[]}]});
 f.ports.execute=input=>({result:sql.run(input),cancelAndDrain:async()=>{}});
 expect(await f.run(validRequest)).toMatchObject({total:{rows:[{[label]:'period',['x\"); DROP TABLE rank; --']:7}]}});
});
it("rejects invalid saved table names, collisions, cells and excessive data before execution",async()=>{
 const good={name:'items',columns:[{name:'amount',type:'number' as const}],rows:[{amount:2}]};
 for(const localTables of [[{...good,name:'_me'}],[{...good,name:'total'}],[{...good,name:'amount'}],[good,{...good,name:'ITEMS'}],[good,good],[{...good,columns:[...good.columns,...good.columns]}],[{...good,columns:[{name:'A label',type:'string' as const},{name:'a LABEL',type:'string' as const}],rows:[{'A label':'x','a LABEL':'y'}]}],[{...good,columns:[{name:'label\0tail',type:'string' as const}],rows:[{'label\0tail':'x'}]}],[{...good,columns:[{name:'x'.repeat(129),type:'string' as const}],rows:[{['x'.repeat(129)]:'x'}]}],[{...good,rows:[{amount:'wrong'}]}],[{...good,rows:[{amount:2,extra:1}]}],[{...good,rows:Array.from({length:10001},()=>({amount:1}))}]]){
  const f=fixture();f.ports.registry=async()=>({...plan,localTables});await expect(f.run(validRequest)).rejects.toThrow();expect(f.calls).toEqual([]);
 }
});


it('sizes the requested result rather than duplicating hidden dependency results in the response budget',async()=>{
 const f=fixture(),sql=createSqliteSql();let internalBytes=0;
 f.ports.registry=async()=>({...plan,queries:[{name:'first',sql:`select printf('%.*c',${Math.floor(QUERY_LIMITS.outputBytes*0.6)},'x') as payload`,dependencies:[]},{name:'total',sql:'select * from first',dependencies:['first']}]});
 f.ports.execute=input=>({result:sql.run(input).then(answer=>{internalBytes=Buffer.byteLength(JSON.stringify(answer));return answer;}),cancelAndDrain:async()=>{}});
 const result=await f.run(validRequest);expect(internalBytes).toBeGreaterThan(QUERY_LIMITS.outputBytes);expect(Object.keys(result)).toEqual(['total']);expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(QUERY_LIMITS.outputBytes);await expect(f.run({values:{},only:['first','total']})).rejects.toThrow('invalid_query_output');
});
it('materializes catalog dependencies within the input budget without charging unreturned tables to the response',async()=>{
 const f=fixture(),sql=createSqliteSql();let verified=0;
 f.ports.registry=async()=>({...plan,queries:[{name:'first',sql:'select first',source:'catalog',dependencies:[]},{name:'second',sql:'select second',source:'catalog',dependencies:[]},{name:'total',sql:'select (select length(payload) from first)+(select length(payload) from second) as amount',dependencies:['first','second']}]});
 f.ports.catalog=async()=>({verify:async()=>{verified++;},execute:async()=>({columns:[{name:'payload',type:'string'}],rows:[{payload:'x'.repeat(600000)}]})});
 f.ports.execute=input=>({result:sql.run(input),cancelAndDrain:async()=>{}});
 expect(await f.run(validRequest)).toMatchObject({total:{rows:[{amount:1200000}]}});expect(verified).toBeGreaterThanOrEqual(5);
 f.ports.catalog=async()=>({verify:async()=>{},execute:async()=>({columns:[{name:'payload',type:'string'}],rows:[{payload:'x'.repeat(QUERY_LIMITS.inputBytes)}]})});
 await expect(f.run(validRequest)).rejects.toThrow('query_input_limit');
});
const outcome=(length:number)=>({columns:[{name:'payload',type:'string' as const}],rows:[{payload:'x'.repeat(length)}]});
it('enforces exact serialized returned-record byte boundaries',async()=>{
 const f=fixture(),overhead=Buffer.byteLength(JSON.stringify({total:outcome(0)}));let length=QUERY_LIMITS.outputBytes-overhead;
 f.ports.execute=()=>({result:Promise.resolve({total:outcome(length)}),cancelAndDrain:async()=>{}});
 expect(Buffer.byteLength(JSON.stringify(await f.run(validRequest)))).toBe(QUERY_LIMITS.outputBytes);length++;
 await expect(f.run(validRequest)).rejects.toThrow('invalid_query_output');
});
it('bounds all internal dependency answers independently of the smaller response projection',async()=>{
 const f=fixture();f.ports.registry=async()=>({...plan,queries:[{name:'first',sql:'select 1',dependencies:[]},{name:'total',sql:'select 1 from first',dependencies:['first']}]});
 const total={columns:[],rows:[]},overhead=Buffer.byteLength(JSON.stringify({first:outcome(0),total}));let length=QUERY_LIMITS.inputBytes-overhead;
 f.ports.execute=()=>({result:Promise.resolve({first:outcome(length),total}),cancelAndDrain:async()=>{}});
 expect(await f.run(validRequest)).toEqual({total});length++;
 await expect(f.run(validRequest)).rejects.toThrow('invalid_query_output');
 for(const invalid of [{columns:[],rows:[],truncated:true},{columns:[],rows:Array(QUERY_LIMITS.rows+1).fill({})},{columns:Array.from({length:500},(_,i)=>({name:'c'+i,type:'string' as const})),rows:Array(2001).fill({})},{columns:[],rows:[null]}]){f.ports.execute=()=>({result:Promise.resolve({first:invalid,total}) as ReturnType<QueryPorts["execute"]>["result"],cancelAndDrain:async()=>{}});await expect(f.run(validRequest)).rejects.toThrow('invalid_query_output');}
});

it('returns bounded multi-megabyte authored data without truncating rows or cells', async () => {
  const f = fixture();
  const rows = Array.from({ length: 600 }, (_, part) => ({
    part,
    chunk: 'x'.repeat(4000),
  }));
  const answer = {
    total: {
      columns: [
        { name: 'part', type: 'number' as const },
        { name: 'chunk', type: 'string' as const },
      ],
      rows,
    },
  };
  f.ports.execute = () => ({
    result: Promise.resolve(answer),
    cancelAndDrain: async () => {},
  });
  expect(Buffer.byteLength(JSON.stringify(answer))).toBeGreaterThan(1024 * 1024);
  expect(await f.run(validRequest)).toEqual(answer);
});
