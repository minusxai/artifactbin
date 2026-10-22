import test from "node:test";
import assert from "node:assert/strict";
import { readCompiledDataset } from "../src/migration/conversion/compiled/dataset-reader.ts";
const binding = {
  name: "items",
  legacyRef: "ref:Abcd12",
  backendNamespace: "legacyDatasets",
  backendHref: "/af/v1/ids/Bac123",
  version: 3,
  mode: "pinned" as const,
  tables: [
    {
      schema: "main",
      table: "rows",
      columns: [{ name: "amount", type: "number" }],
    },
  ],
};
const window = {
  version: 3,
  generation: 0,
  schema: "main",
  table: "rows",
  columns: [{ name: "amount", type: "number" }],
  rows: [{ amount: 2 }],
  offset: 0,
  nextOffset: null,
  totalRows: 1,
};
test("dataset reader loads complete contiguous windows into transient engine tables", async () => {
  const calls: any[] = [];
  const result = await readCompiledDataset(binding, async (namespace, args) => {
    calls.push({ namespace, args });
    return {
      ...window,
      rows: [{ amount: args.offset + 1 }],
      offset: args.offset,
      nextOffset: args.offset === 0 ? 1 : null,
      totalRows: 2,
    };
  });
  assert.deepEqual(result.rows, {
    columns: binding.tables[0]!.columns,
    rows: [{ amount: 1 }, { amount: 2 }],
  });
  assert.deepEqual(
    calls.map((c) => c.args.offset),
    [0, 1],
  );
  assert.equal(calls[0].namespace, "legacyDatasets");
  assert.equal(calls[0].args.binding, "items");
});
test("dataset reader refuses incomplete, unstable, oversized or ill-typed reads without returning partial rows", async () => {
  for (const change of [
    { version: 4 },
    { schema: "other" },
    { offset: 1 },
    { nextOffset: 0 },
    { totalRows: 2 },
    { rows: [{ amount: "bad" }] },
    { rows: [{ amount: Infinity }] },
    { columns: [{ name: "other", type: "number" }] },
  ]) {
    await assert.rejects(
      readCompiledDataset(
        binding,
        async () => ({ ...window, ...change }) as any,
      ),
      /^Error: Dataset read unavailable$/,
    );
  }
  await assert.rejects(
    readCompiledDataset(binding, async () => window, { maxBytes: 10 }),
    /Dataset read unavailable/,
  );
  await assert.rejects(
    readCompiledDataset(binding, async () => window, { maxRows: 0 }),
    /Dataset read unavailable/,
  );
  await assert.rejects(
    readCompiledDataset(binding, async () => {
      throw Error("private server detail");
    }),
    /^Error: Dataset read unavailable$/,
  );
});

test("shared refresh budgets and deadlines bound the entire read generation", async () => {
  const budget = { bytes: 0, rows: 0 };
  await readCompiledDataset(
    binding,
    async () => window,
    { maxRows: 1 },
    budget,
  );
  await assert.rejects(
    readCompiledDataset(binding, async () => window, { maxRows: 1 }, budget),
    /Dataset read unavailable/,
  );
  let finish: any,
    calls = 0;
  const waiting = readCompiledDataset(
    binding,
    async () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    { timeoutMs: 5 },
  );
  await assert.rejects(waiting, /Dataset read unavailable/);
  finish({ ...window, totalRows: 2, nextOffset: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  let index = 0;
  await assert.rejects(
    readCompiledDataset(binding, async () => ({
      ...window,
      offset: index,
      nextOffset: index++ === 0 ? 1 : null,
      totalRows: 2,
      version: index === 1 ? 3 : 4,
    })),
    /Dataset read unavailable/,
  );
});

test("live reads latch version and generation and retry a changed snapshot without mixing rows", async () => {
  const calls: any[] = [];
  let attempt = 0;
  const result = await readCompiledDataset(
    { ...binding, mode: "live" },
    async (_namespace, args) => {
      calls.push(args);
      if (args.offset === 0) attempt++;
      if (attempt === 1 && args.offset > 0) throw Error("dataset_changed");
      return {
        ...window,
        version: attempt + 3,
        generation: attempt,
        offset: args.offset,
        rows: [{ amount: attempt * 10 + args.offset }],
        nextOffset: args.offset === 0 ? 1 : null,
        totalRows: 2,
      };
    },
  );
  assert.deepEqual(result.rows!.rows, [{ amount: 20 }, { amount: 21 }]);
  assert.equal(calls[0].expectedVersion, undefined);
  assert.equal(calls[1].expectedVersion, 4);
  assert.equal(calls[1].expectedGeneration, 1);
  assert.equal(calls[2].expectedVersion, undefined);
  assert.equal(calls[3].expectedVersion, 5);
  assert.equal(calls[3].expectedGeneration, 2);
});
test("repeated live changes exhaust bounded retry and never expose partial rows", async () => {
  let calls = 0;
  await assert.rejects(
    readCompiledDataset(
      { ...binding, mode: "live" },
      async (_namespace, args) => {
        calls++;
        return {
          ...window,
          version: 4,
          generation: args.offset,
          offset: args.offset,
          rows: [{ amount: 1 }],
          nextOffset: args.offset === 0 ? 1 : null,
          totalRows: 2,
        };
      },
    ),
    /Dataset read unavailable/,
  );
  assert.equal(calls, 4);
});

test("dataset notification observers refresh complete snapshots and release subscriptions", async () => {
  const { datasetBootStatus } = await import(
    "../src/migration/conversion/compiled/dataset-boot.ts"
  );
  const { runInNewContext } = await import("node:vm");
  const callbacks: Function[] = [];
  let refreshes = 0,
    released = 0;
  const events: Record<string, Function> = {};
  const noop = () => {};
  runInNewContext(datasetBootStatus, {
    document: {
      querySelector: () => ({ textContent: "", hidden: false, after: noop }),
      createElement: () => ({ addEventListener: noop }),
    },
    window: {
      addEventListener: (name: string, fn: Function) => (events[name] = fn),
    },
    datasetBindings: [binding],
    datasetDocuments: { legacyDatasets: {} },
    client: {
      watchQuery: () => ({
        subscribe: (fn: Function) => {
          callbacks.push(fn);
          return { unsubscribe: () => released++ };
        },
      }),
    },
    engine: { invalidate: () => refreshes++ },
    flow: { imports: [{ ref: "sample" }] },
    setTables: noop,
    setQueryErrors: noop,
    run: noop,
  });
  callbacks[0]!({ data: { legacyDatasets: null } });
  assert.equal(refreshes, 0);
  callbacks[0]!({ data: { legacyDatasets: { read: window } } });
  assert.equal(refreshes, 0);
  callbacks[0]!({ data: { legacyDatasets: { read: window } } });
  assert.equal(refreshes, 1);
  callbacks[0]!({
    data: { legacyDatasets: null },
    errors: [{ message: "unavailable" }],
  });
  assert.equal(refreshes, 2);
  events.pagehide!({ persisted: true });
  assert.equal(released, 0);
  events.pagehide!({ persisted: false });
  assert.equal(released, 1);
});
