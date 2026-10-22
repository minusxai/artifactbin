import {
  createCompiledQueryController,
  compiledQueryClock,
} from "../src/migration/conversion/compiled/query-controller.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { localBootSource } from "../src/migration/conversion/compiled/local-boot.ts";
import type { CompiledQueryEvaluation } from "../src/migration/conversion/compiled/query-evaluation-contracts.ts";

test("one option evaluation retains its clock across completion pages crossing a time predicate", async () => {
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
  let clock = Date.parse("2026-01-01T00:00:00Z");
  class AdvancingDate extends Date {
    constructor() {
      super(clock);
      clock += 1000;
    }
    static now() {
      return 0;
    }
  }
  let notify!: (value: unknown) => void, context: any;
  const initial = {
    columns: [{ name: "label", type: "string" }],
    rows: [{ label: "first" }],
    totalRows: 3,
  };
  const contexts: CompiledQueryEvaluation[] = [];
  const engine = {
    prepare() {},
    ready: () => true,
    run: async (
      _flow: unknown,
      _queries: unknown,
      evaluation: CompiledQueryEvaluation,
    ) => {
      contexts.push(evaluation);
      return { tables: { options: initial }, errors: {} };
    },
    page: async (
      _flow: unknown,
      _query: unknown,
      page: { offset: number },
      evaluation: CompiledQueryEvaluation,
    ) => {
      contexts.push(evaluation);
      const beforeBoundary = evaluation.now === "2026-01-01T00:00:00.000Z";
      return {
        ...initial,
        rows: [
          {
            label: beforeBoundary
              ? `same-snapshot-${page.offset}`
              : "changed-after-boundary",
          },
        ],
      };
    },
  };
  const executable =
    source
      .replace(/^import .*;\n/gm, "")
      .replace("export function boot", "function boot") + ";boot({TREE:{}});";
  runInNewContext(executable, {
    createCompiledQueryController,
    compiledQueryClock,
    AbortController,
    TextEncoder,
    Date: AdvancingDate,
    Uint8Array,
    atob: () => "",
    setTimeout: () => 1,
    clearTimeout() {},
    window: { addEventListener() {} },
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
  notify({ data: { compiledPage: {} } });
  for (let i = 0; i < 24; i++) await Promise.resolve();
  assert.deepEqual(JSON.parse(JSON.stringify(context.table("options").rows)), [
    { label: "first" },
    { label: "same-snapshot-1" },
    { label: "same-snapshot-2" },
  ]);
  assert.equal(contexts.length, 3);
  assert.equal(new Set(contexts.map((value) => value.now)).size, 1);
  notify({ data: { compiledPage: {} } });
  for (let i = 0; i < 24; i++) await Promise.resolve();
  assert.equal(contexts.length, 6);
  assert.equal(new Set(contexts.slice(3).map((value) => value.now)).size, 1);
  assert.notEqual(contexts[0]!.now, contexts[3]!.now);
});
