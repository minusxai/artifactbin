import test from "node:test";
import assert from "node:assert/strict";
import { createAuthorBindings } from "../src/migration/conversion/compiled/author/bindings.ts";
import { authorApolloPorts } from "../src/migration/conversion/compiled/author/apollo-ports.ts";
import type {
  AuthorPorts,
  ReactivePort,
  Row,
} from "../src/migration/conversion/compiled/author/contracts.ts";
const reactive: ReactivePort = {
  signal(value) {
    let v = value;
    return [
      () => v,
      (next) =>
        (v =
          typeof next === "function"
            ? (next as (v: typeof value) => typeof value)(v)
            : next),
    ];
  },
  untrack: (f) => f(),
  identity: () => null,
  scope: (_, f) => f(),
};
const noState: AuthorPorts["state"] = {
  read: () => undefined,
  write() {},
  subscribe: () => () => {},
};
function fixture(mutation?: AuthorPorts["mutation"]) {
  return createAuthorBindings(
    {
      state: noState,
      query: () => {
        throw Error("unused");
      },
      ...(mutation ? { mutation } : {}),
    },
    { values: [], queries: [], mutations: ["save"] },
    reactive,
  );
}
test("declared mutation ABI caches callable, snapshots scalar arguments and _row, resolves void only after commit", async () => {
  let finish!: (value: unknown) => void;
  let input: Readonly<Row> | undefined, row: Readonly<Row> | undefined;
  const b = fixture(async (name, args, selected) => {
    assert.equal(name, "save");
    input = args;
    row = selected;
    return new Promise((r) => (finish = r));
  });
  const fn = b.mutation("$save");
  assert.equal(fn, b.mutation("$save"));
  const args = { value: 4, _row: { id: "row-1" } };
  let settled = false;
  const pending = fn(args).then((v) => {
    settled = true;
    return v;
  });
  args.value = 8;
  args._row.id = "row-2";
  await Promise.resolve();
  assert.equal(input?.value, 4);
  assert.equal(row?.id, "row-1");
  assert.equal(settled, false);
  finish({ affected: 1 });
  assert.equal(await pending, undefined);
  b.dispose();
});
test("unknown names, missing port and malformed scalar/row objects never dispatch", async () => {
  let calls = 0;
  const b = fixture(async () => {
    calls++;
  });
  assert.throws(() => b.mutation("$other"));
  assert.throws(() => b.mutation("save"));
  assert.throws(() => fixture().mutation("$save"));
  let getters = 0;
  const accessor = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      getters++;
      return 1;
    },
  });
  for (const args of [
    null,
    [],
    { value: NaN },
    { value: {} },
    { _row: [] },
    { _row: { id: {} } },
    accessor,
    Object.create({ value: 1 }),
    { [Symbol("key")]: 1 },
  ])
    await assert.rejects(b.mutation("$save")(args as never));
  assert.equal(getters, 0);
  assert.equal(calls, 0);
  b.dispose();
  assert.throws(() => b.mutation("$save"));
});
test("disposal rejects an in-flight authored mutation and ignores a late commit", async () => {
  let finish!: () => void;
  const b = fixture(() => new Promise<void>((r) => (finish = r)));
  const fn = b.mutation("$save");
  const pending = fn();
  await Promise.resolve();
  b.dispose();
  await assert.rejects(pending, /disposed/);
  finish();
  await assert.rejects(fn(), /disposed/);
});
test("trusted port only routes exact registrations under fresh unchanged authority and preserves refusals", async () => {
  let context: string | null = "epoch1",
    calls = 0,
    finish!: (
      v: import("../src/migration/conversion/compiled/dataset-mutations-contracts.ts").CompiledMutationResult,
    ) => void;
  const ports = authorApolloPorts(
    {} as never,
    {} as never,
    () => {
      throw Error("unused");
    },
    {
      names: ["save"],
      authorizationContext: () => context,
      adapter: {
        mutate: async (name, args, row) => {
          calls++;
          assert.equal(name, "save");
          return new Promise((r) => (finish = r));
        },
      },
    },
  );
  await assert.rejects(ports.mutation!("other", {}));
  context = null;
  await assert.rejects(ports.mutation!("save", {}));
  assert.equal(calls, 0);
  context = "epoch1";
  const pending = ports.mutation!("save", {});
  await Promise.resolve();
  context = "epoch2";
  finish({ affected: 1, rowCount: 1, version: 1, generation: 1 });
  await assert.rejects(pending, /context/);
  assert.equal(calls, 1);
  const error = Object.assign(Error("Dataset mutation unknown"), {
    outcome: "unknown",
  });
  const refused = authorApolloPorts(
    {} as never,
    {} as never,
    () => {
      throw Error("unused");
    },
    {
      names: ["save"],
      authorizationContext: () => context,
      adapter: {
        mutate: async () => {
          throw error;
        },
      },
    },
  );
  await assert.rejects(refused.mutation!("save", {}), (e) => e === error);
});

test("authored unknown outcomes remain visible to durable adapter recovery without automatic replay", async () => {
  const { parse } = await import("graphql");
  const { createCompiledDatasetMutations } = await import(
    "../src/migration/conversion/compiled/dataset-mutations.ts"
  );
  const calls: unknown[] = [];
  let stored: Record<string, any> = {};
  const result = { affected: 1, rowCount: 1, version: 1, generation: 1 };
  const adapter = createCompiledDatasetMutations({
    bindings: [
      {
        name: "save",
        recoveryScope: "a".repeat(64),
        backendNamespace: "data",
        paramTypes: { amount: "number" },
      },
    ],
    documents: {
      data: parse(
        "mutation Write($operation:String!,$requestId:String!,$params:DatasetParams!){data{mutate(operation:$operation,requestId:$requestId,params:$params){affected rowCount version generation}}}",
      ),
    },
    client: {
      mutate: async (options: any) => {
        calls.push(options.variables);
        if (calls.length === 1) throw Error("connection lost");
        return {
          data: { data: { mutate: result } },
          extensions: { outcomes: { "data.mutate": "committed" } },
        } as any;
      },
    },
    requestId: () => "request-00000001",
    values: () => ({}),
    reset: () => {},
    committed: () => {},
    authorizationContext: () => "caller-epoch",
    intentStore: {
      read: () => stored,
      compareAndSet: async (name, expected, next) => {
        if ((stored[name]?.requestId ?? null) !== expected) return false;
        stored = { ...stored };
        if (next) stored[name] = next;
        else delete stored[name];
        return true;
      },
    },
  });
  const ports = authorApolloPorts(
    {} as never,
    {} as never,
    () => {
      throw Error("unused");
    },
    { names: ["save"], adapter, authorizationContext: () => "caller-epoch" },
  );
  await assert.rejects(ports.mutation!("save", { amount: 3 }), /unknown/);
  assert.equal(adapter.status("save")?.state, "unknown");
  assert.equal(Object.keys(stored).length, 1);
  await assert.rejects(ports.mutation!("save", { amount: 4 }), /unknown/);
  assert.equal(calls.length, 1);
  assert.deepEqual(await adapter.retry("save"), result);
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(adapter.status("save")?.state, "committed");
  assert.deepEqual(stored, {});
});

test("argument snapshots bound payloads and preserve ordinary prototype-named scalar fields safely", async () => {
  let captured: Readonly<Row> | undefined;
  const b = fixture(async (_name, args) => {
    captured = args;
  });
  const save = b.mutation("$save");
  await save(
    JSON.parse('{"__proto__":"literal","constructor":3,"prototype":true}'),
  );
  assert.equal(Object.getPrototypeOf(captured), null);
  assert.equal(captured!.__proto__, "literal");
  assert.equal(captured!.constructor, 3);
  for (const args of [
    { value: "x".repeat(256 * 1024) },
    Object.fromEntries(Array.from({ length: 257 }, (_, i) => ["k" + i, i])),
    Object.defineProperty({}, "hidden", { value: 1 }),
  ])
    await assert.rejects(save(args));
  b.dispose();
});
