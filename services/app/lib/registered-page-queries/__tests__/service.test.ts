import { createSqliteSql } from "@artifactbin/sql/sqlite";
import { it, expect } from "vitest";
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
