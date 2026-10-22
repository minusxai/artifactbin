import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { localBootSource } from "../src/migration/conversion/compiled/local-boot.ts";
import {
  createCompiledQueryController,
  compiledQueryClock,
} from "../src/migration/conversion/compiled/query-controller.ts";
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
    createCompiledQueryController: (configuration: any, ports: any) =>
      createCompiledQueryController(configuration, {
        ...ports,
        clock: {
          ...compiledQueryClock,
          schedule: (callback: () => void) => {
            timers.add(callback);
            return () => timers.delete(callback);
          },
        },
      }),
    compiledQueryClock,
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
  assert.equal(timers.size, 2);
  notify({ data: { compiledPage: {} } });
  await settle();
  assert.equal(pageCalls, 2);
  assert.equal(timers.size, 2);
  pending[0]!.resolve({ ...initial, rows: [{ label: "old" }] });
  await settle();
  assert.equal(context.table("options"), undefined);
  events.get("pagehide")!({ persisted: true });
  assert.equal(timers.size, 2);
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
