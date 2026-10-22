import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { localBootSource } from "../src/migration/conversion/compiled/local-boot.ts";
import type { CompleteControlOptions } from "../src/migration/conversion/compiled/control-options-contracts.ts";
test("generated boot embeds a standalone compatible pagination function with deadline cleanup", async () => {
  const boot = localBootSource([]);
  const start = boot.indexOf("const completeControlOptions=");
  const end = boot.indexOf("\nconst controlPageRequest=", start);
  assert.ok(start >= 0 && end > start);
  const complete = runInNewContext(
    boot.slice(start, end) + ";completeControlOptions",
    { AbortController, TextEncoder },
  ) as CompleteControlOptions;
  const initial = {
    columns: [{ name: "n", type: "number" }],
    rows: [{ n: 1 }],
    totalRows: 2,
  };
  let disposed = 0;
  const answer = await complete(
    initial,
    async (offset) => {
      assert.equal(offset, 1);
      return { ...initial, rows: [{ n: 2 }] };
    },
    {},
    {
      now: () => 0,
      schedule: () => () => {
        disposed++;
      },
    },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(answer.rows)), [
    { n: 1 },
    { n: 2 },
  ]);
  assert.equal(disposed, 1);
  let timeout!: () => void;
  const pending = complete(
    initial,
    () => new Promise(() => {}),
    {},
    {
      now: () => 0,
      schedule: (callback) => {
        timeout = callback;
        return () => {
          disposed++;
        };
      },
    },
  );
  const rejected = assert.rejects(pending, /timed out/);
  timeout();
  await rejected;
  assert.equal(disposed, 2);
});
test("generated boot cancels hung option pagination on supersede and page disposal without late publication", async () => {
  const source = localBootSource(
    [],
    {
      flow: { queries: [{ name: "options" }], imports: [] },
      wasmBase64: "",
      tables: {},
    },
    undefined,
    undefined,
    false,
    [],
    [{ kind: "select", options: "options", value: "selected" }],
  );
  let notify!: (value: unknown) => void;
  const events = new Map<string, (event: { persisted: boolean }) => void>();
  let context: any;
  const pending: Array<{
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = [];
  const timers = new Set<unknown>();
  let pageCalls = 0;
  const initial = {
    columns: [{ name: "label", type: "string" }],
    rows: [{ label: "first" }],
    totalRows: 2,
  };
  const engine = {
    prepare() {},
    ready: () => true,
    run: async () => ({ tables: { options: initial }, errors: {} }),
    page: () => {
      pageCalls++;
      return new Promise((resolve, reject) =>
        pending.push({ resolve, reject }),
      );
    },
  };
  const executable =
    source
      .replace(/^import .*;\n/gm, "")
      .replace("export function boot", "function boot") + ";boot({TREE:{}});";
  runInNewContext(executable, {
    AbortController,
    TextEncoder,
    atob: () => "",
    Date,
    Uint8Array,
    setTimeout: (callback: () => void) => {
      timers.add(callback);
      return callback;
    },
    clearTimeout: (timer: unknown) => timers.delete(timer),
    window: {
      addEventListener: (
        name: string,
        callback: (event: { persisted: boolean }) => void,
      ) => events.set(name, callback),
    },
    document: {
      createElement: () => ({
        setAttribute() {},
        dataset: {},
        textContent: "",
      }),
      body: { append() {} },
    },
    createSignal: (initial: unknown) => {
      let value = initial;
      return [
        () => value,
        (next: unknown) => {
          value = next;
        },
      ];
    },
    createRoot: (fn: () => void) => fn(),
    createEffect: (fn: () => void) => fn(),
    untrack: (fn: () => void) => fn(),
    gql: () => ({}),
    client: {
      watchQuery: () => ({
        subscribe: (callback: typeof notify) => {
          notify = callback;
          return { unsubscribe() {} };
        },
      }),
    },
    hydrateIsland: (_id: unknown, _tree: unknown, next: unknown) => {
      context = next;
    },
    markCompiledReady() {},
    pageEngine: () => engine,
  });
  const settle = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  notify({ data: { compiledPage: {} } });
  await settle();
  assert.equal(pageCalls, 1);
  assert.equal(timers.size, 1);
  notify({ data: { compiledPage: {} } });
  await settle();
  assert.equal(pageCalls, 2);
  assert.equal(timers.size, 1);
  pending[0]!.resolve({ ...initial, rows: [{ label: "old" }] });
  await settle();
  assert.equal(context.table("options"), undefined);
  events.get("pagehide")!({ persisted: true });
  assert.equal(timers.size, 1);
  events.get("pagehide")!({ persisted: false });
  await settle();
  assert.equal(timers.size, 0);
  pending[1]!.reject(Error("late failure"));
  await settle();
  notify({ data: { compiledPage: {} } });
  await settle();
  assert.equal(pageCalls, 2);
  assert.equal(context.table("options"), undefined);
});
