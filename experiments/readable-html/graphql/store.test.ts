import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, createRemote, migrateSnapshot } from "./store.ts";
const sdl =
  "type Task { id: ID!, title: String!, done: Boolean! } type Query { count: Int!, tasks: [Task!]!, bad: Int } type Mutation { add(n: Int!): Int!, task(title: String!): Task!, fail: Int, bad: Int }";
const make = () =>
  createStore({
    sdl,
    version: 1,
    initial: { count: 0, tasks: [] },
    queries: {
      count: (s) => s.count,
      tasks: (s) => s.tasks,
      bad: (s) => {
        s.count++;
        return s.count;
      },
    },
    mutations: {
      add: (s, a) => (s.count += a.n),
      task: (s, a) => {
        const t = {
          id: String(s.tasks.length + 1),
          title: a.title,
          done: false,
        };
        s.tasks.push(t);
        return t;
      },
      fail: () => {
        throw Error("failure");
      },
      bad: (s) => {
        s.count = NaN;
        return 0;
      },
    },
  });
test("aliases and variables commit all fields once; failed later field rolls entire operation back", () => {
  const s = make();
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        s.mutate("mutation($n:Int!){a:add(n:$n) b:add(n:2)}", { n: 3 }).data,
      ),
    ),
    { a: 3, b: 5 },
  );
  assert.equal(s.snapshot().revision, 1);
  assert.ok(s.mutate("mutation {add(n:4) fail}").errors);
  assert.equal((s.snapshot().state as any).count, 5);
  assert.equal(s.snapshot().revision, 1);
});
test("syntax, validation, operation-kind and variable failures cannot mutate; JSON failure rolls back", () => {
  const s = make();
  for (const source of [
    "mutation { nope }",
    'mutation {add(n:"x")}',
    "mutation {",
    "{count}",
    "mutation {bad}",
  ])
    assert.ok(s.mutate(source).errors);
  assert.equal(s.snapshot().revision, 0);
  assert.ok(s.query("mutation {add(n:1)}").errors);
});
test("query receives deep frozen state; snapshots do not alias store", () => {
  const s = make();
  assert.ok(s.query("{bad}").errors);
  const shot = s.snapshot();
  (shot.state as any).count = 999;
  assert.equal((s.query("{count}").data as any).count, 0);
});
test("two independent consumer adapters observe same commit, unsubscribe, errors isolated", () => {
  const s = make();
  const a: number[] = [],
    b: number[] = [];
  const off = s.watch("{count}", (r) => a.push((r.data as any).count));
  s.watch("{count}", () => {
    throw Error("consumer");
  });
  s.watch("{count}", (r) => b.push((r.data as any).count));
  s.mutate('mutation {task(title:"one"){id title} }');
  s.mutate("mutation {add(n:1)}");
  off();
  s.mutate("mutation {add(n:1)}");
  assert.deepEqual(a, [0, 1]);
  assert.deepEqual(b, [0, 1, 2]);
  s.dispose();
  assert.ok(s.query("{count}").errors);
  assert.throws(() => s.watch("{count}", () => {}));
});
test("invalid JSON rejected including cycles, prototypes, nonfinite and undefined", () => {
  for (const initial of [
    NaN,
    undefined,
    () => {},
    new Date(),
    { a: undefined },
    Object.assign([], { bad: 1 }),
  ])
    assert.throws(() =>
      createStore({
        sdl,
        version: 1,
        initial: initial as any,
        queries: {},
        mutations: {},
      }),
    );
  const a: any = {};
  a.a = a;
  assert.throws(() =>
    createStore({ sdl, version: 1, initial: a, queries: {}, mutations: {} }),
  );
});
test("migration is explicit versioned pure transform; old snapshot stays unchanged", () => {
  const old = { version: 1, revision: 2, state: { count: 3 } };
  const next = migrateSnapshot(old, 2, {
    1: (s) => ({ ...(s as any), tasks: [] }),
  });
  assert.equal(next.version, 2);
  assert.deepEqual(old.state, { count: 3 });
  assert.throws(() => migrateSnapshot(old, 3, {}));
  assert.throws(() => migrateSnapshot(next, 1, {}));
});
test("async local resolvers rejected and leaked draft cannot mutate committed state", async () => {
  let draft: any;
  const s = createStore({
    sdl,
    version: 1,
    initial: { count: 0 },
    queries: { count: (s) => s.count },
    mutations: {
      add: (s) => {
        draft = s;
        s.count++;
        return s.count;
      },
      fail: async (s) => {
        s.count++;
        return 1;
      },
    },
  });
  s.mutate("mutation {add(n:1)}");
  draft.count = 100;
  assert.equal((s.snapshot().state as any).count, 1);
  assert.ok(s.mutate("mutation {fail}").errors);
  await Promise.resolve();
  assert.equal((s.snapshot().state as any).count, 1);
});
test("remote pending/committed/rejected/offline and cancellation unknown; never changes local state", async () => {
  let calls = 0;
  let online = true;
  const r = createRemote({
    sdl: "type Query { x:Int } type Mutation { save(n:Int!):Int }",
    online: () => online,
    resolvers: {
      save: async (a) => {
        calls++;
        return a.n;
      },
    },
  });
  const op = r.execute("mutation {save(n:2)}");
  assert.equal(op.status, "pending");
  assert.equal((await op.settled).status, "committed");
  assert.equal(calls, 1);
  online = false;
  assert.equal(
    (await r.execute("mutation {save(n:2)}").settled).status,
    "offline",
  );
  assert.equal(calls, 1);
  online = true;
  assert.equal((await r.execute("{x}").settled).status, "rejected");
  assert.equal(
    (await r.execute("mutation {missing}").settled).status,
    "rejected",
  );
  const slow = createRemote({
    sdl: "type Query{x:Int} type Mutation{save:Int}",
    online: () => true,
    resolvers: { save: async () => new Promise(() => {}) },
  });
  const p = slow.execute("mutation {save}");
  p.cancel();
  assert.equal((await p.settled).status, "unknown");
});

test("reentrant watcher mutations rejected and disposed watchers stop", () => {
  const s = make();
  let receipt: any;
  let count = 0;
  const off = s.watch("{count}", () => {
    count++;
    receipt = s.mutate("mutation {add(n:1)}");
  });
  assert.ok(receipt.errors);
  s.mutate("mutation {add(n:2)}");
  assert.equal((s.snapshot().state as any).count, 2);
  assert.equal(count, 2);
  off();
  s.mutate("mutation {add(n:3)}");
  assert.equal(count, 2);
});
test("async query and mutation rejection never trigger another revision", async () => {
  const s = createStore({
    sdl,
    initial: { count: 0 },
    version: 1,
    queries: { count: async () => 5 },
    mutations: {
      add: async (state) => {
        await Promise.resolve();
        state.count = 10;
        throw Error("late failure");
      },
    },
  });
  assert.ok(s.query("{count}").errors);
  assert.ok(s.mutate("mutation {add(n:1)}").errors);
  await new Promise((r) => setTimeout(r, 1));
  assert.equal(s.snapshot().revision, 0);
  assert.equal((s.snapshot().state as any).count, 0);
});
test("remote resolver failure is unknown rather than claiming rollback; multiple/fragment roots rejected", async () => {
  let calls = 0;
  const r = createRemote({
    sdl: "type Query{x:Int} type Mutation{save(n:Int!):Int}",
    online: () => true,
    resolvers: {
      save: async () => {
        calls++;
        throw Error("response lost after side effect");
      },
    },
  });
  assert.equal(
    (await r.execute("mutation {save(n:1)}").settled).status,
    "unknown",
  );
  for (const source of [
    "mutation {a:save(n:1) b:save(n:2)}",
    "mutation {...F} fragment F on Mutation {save(n:1)}",
    "mutation($n:Int!){save(n:$n)}",
  ])
    assert.equal((await r.execute(source).settled).status, "rejected");
  assert.equal(calls, 1);
});
test("one named-operation facade routes local/remote explicitly and cannot mix domains", async () => {
  const { createApp } = await import("./store.ts");
  let remoteCalls = 0;
  const local = make();
  const remote = createRemote({
    sdl: "type Query{x:Int} type Mutation{save:Int}",
    online: () => true,
    resolvers: { save: async () => ++remoteCalls },
  });
  const app = createApp(local, remote, {
    increment: { location: "local", source: "mutation{add(n:1)}" },
    upload: { location: "remote", source: "mutation{save}" },
    mixed: { location: "local", source: "mutation{add(n:1) save}" },
  });
  assert.equal((await app.execute("increment").settled).status, "committed");
  assert.equal((await app.execute("upload").settled).status, "committed");
  assert.equal((await app.execute("mixed").settled).status, "rejected");
  assert.equal((await app.execute("__proto__").settled).status, "rejected");
  assert.equal(remoteCalls, 1);
  assert.equal((app.query("{count}").data as any).count, 1);
});
test("history snapshot reads are inert and migration failures preserve source", () => {
  const old = make();
  old.mutate("mutation{add(n:2)}");
  const snap = old.snapshot();
  const historic = createStore({
    sdl,
    initial: snap.state,
    version: snap.version,
    queries: { count: (s) => s.count },
    mutations: {},
  });
  assert.equal((historic.query("{count}").data as any).count, 2);
  assert.throws(() =>
    migrateSnapshot(snap, 2, {
      1: (s) => {
        (s as any).count = 10;
        return s;
      },
    }),
  );
  assert.equal((snap.state as any).count, 2);
});

test("resolver cannot reenter store and silently overwrite another commit", () => {
  let nested: any;
  let s: any;
  s = createStore({
    sdl,
    version: 1,
    initial: { count: 0 },
    queries: { count: (s) => s.count },
    mutations: {
      add: (state) => {
        nested = s.mutate('mutation{task(title:"x"){id}}');
        state.count++;
        return state.count;
      },
      task: () => ({ id: "1", title: "x", done: false }),
    },
  });
  s.mutate("mutation{add(n:1)}");
  assert.ok(nested.errors);
  assert.equal(s.snapshot().revision, 1);
});
test("watch captures variables; changing caller object cannot retarget subscription", () => {
  const s = createStore({
    sdl: "type Query{value(n:Int!):Int} type Mutation{tick:Int}",
    version: 1,
    initial: 0,
    queries: { value: (_, a) => a.n },
    mutations: { tick: () => 1 },
  });
  const variables = { n: 1 };
  const values: any[] = [];
  s.watch("query($n:Int!){value(n:$n)}", (r) => values.push(r.data), variables);
  variables.n = 7;
  s.mutate("mutation{tick}");
  assert.equal(values.length, 1);
  assert.equal(values[0].value, 1);
});
test("query budgets include aliases, expanded fragments, cycles, depth and bytes", () => {
  const s = make();
  const aliases = Array.from({ length: 513 }, (_, i) => `a${i}:count`).join(
    " ",
  );
  for (const source of [
    "{" + aliases + "}",
    "{count}" + " ".repeat(16384),
    "query{...A} fragment A on Query {...B ...B} fragment B on Query {...A}",
    "{" + "tasks{".repeat(65) + "id" + "}".repeat(66),
  ])
    assert.ok(s.query(source).errors);
});
test("remote query is explicit; stored historical reads do not invoke it", async () => {
  let calls = 0;
  const remote = createRemote({
    sdl: "type Query{load:Int} type Mutation{save:Int}",
    online: () => true,
    resolvers: { load: async () => ++calls },
  });
  const { createApp } = await import("./store.ts");
  const local = make();
  const app = createApp(local, remote, {
    load: { location: "remote", source: "{load}" },
  });
  assert.equal((await app.execute("load").settled).status, "committed");
  app.query("{count}");
  local.snapshot();
  assert.equal(calls, 1);
});
test("query resolver cannot mutate through captured store API", () => {
  let s: any;
  s = createStore({
    sdl,
    version: 1,
    initial: { count: 0 },
    queries: {
      count: () => {
        assert.ok(s.mutate("mutation{add(n:1)}").errors);
        return 0;
      },
    },
    mutations: { add: (s) => ++s.count },
  });
  s.query("{count}");
  assert.equal(s.snapshot().revision, 0);
});
test("taskboard transactions expose validated selections and one coherent watcher update", () => {
  const s = make();
  const events: any[] = [];
  s.watch("{tasks{id title done}}", (r) => events.push(r.data));
  const result = s.mutate(
    'mutation{a:task(title:"Ship"){id} b:task(title:"Review"){id}}',
  );
  assert.ok(!result.errors);
  assert.equal(events.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(events[1])), {
    tasks: [
      { id: "1", title: "Ship", done: false },
      { id: "2", title: "Review", done: false },
    ],
  });
  s.mutate('mutation{task(title:"Rollback"){id} fail}');
  assert.equal(events.length, 2);
});
test("remote cancellation signals resolver without asserting rollback; server error text is not leaked", async () => {
  let signal: AbortSignal | undefined;
  const remote = createRemote({
    sdl: "type Query{x:Int} type Mutation{save:Int}",
    online: () => true,
    resolvers: {
      save: async (_, s) => {
        signal = s;
        await new Promise((r) => setTimeout(r, 1));
        throw Error("private database password");
      },
    },
  });
  const op = remote.execute("mutation{save}");
  op.cancel();
  assert.equal(signal?.aborted, true);
  assert.equal((await op.settled).status, "unknown");
  const result = await remote.execute("mutation{save}").settled;
  assert.equal(result.status, "unknown");
  assert.ok(!JSON.stringify(result).includes("password"));
});
test("migration rejects invalid metadata and non-JSON output", () => {
  for (const version of [NaN, 0, -1, 1.5])
    assert.throws(() =>
      migrateSnapshot({ version, revision: 0, state: {} }, 2, {}),
    );
  assert.throws(() =>
    migrateSnapshot({ version: 1, revision: 0, state: {} }, 2, {
      1: () => NaN,
    }),
  );
});
test("sparse array cannot hide a decorated key behind equal key count", () => {
  const invalid: any[] = [];
  invalid.length = 2;
  invalid[1] = 1;
  (invalid as any).foo = 2;
  assert.throws(() =>
    createStore({
      sdl,
      version: 1,
      initial: invalid,
      queries: {},
      mutations: {},
    }),
  );
  const hidden = {};
  Object.defineProperty(hidden, "x", { value: 1, enumerable: false });
  assert.throws(() =>
    createStore({
      sdl,
      version: 1,
      initial: hidden,
      queries: {},
      mutations: {},
    }),
  );
});
test("migration rejects accessor/hidden state before cloning can erase the violation", () => {
  let touched = false;
  const state = {
    get x() {
      touched = true;
      return 1;
    },
  };
  assert.throws(() =>
    migrateSnapshot({ version: 1, revision: 0, state }, 2, { 1: (s) => s }),
  );
  assert.equal(touched, false);
});
test("missing nullable remote resolver cannot produce false committed receipt", async () => {
  const remote = createRemote({
    sdl: "type Query{x:Int} type Mutation{save:Int}",
    online: () => true,
    resolvers: {},
  });
  assert.equal(
    (await remote.execute("mutation{save}").settled).status,
    "rejected",
  );
});
