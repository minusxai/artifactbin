import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { localBootSource } from "../src/migration/conversion/compiled/local-boot.ts";
import { createCompiledMembers } from "../src/migration/conversion/compiled/members-runtime.ts";
import { createCompiledViewer } from "../src/migration/conversion/compiled/viewer-runtime.ts";
import {
  createCompiledQueryController,
  compiledQueryClock,
} from "../src/migration/conversion/compiled/query-controller.ts";
const flush = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const members = {
  generation: "a".repeat(64),
  rows: [{ user_id: "member", joined_at: "2026-01-01T00:00:00.000Z" }],
};
function setup() {
  const read = deferred<unknown>(),
    watches = new Map<string, (value: any) => void>();
  const events: ((event: { persisted: boolean }) => void)[] = [];
  const content = {
      hidden: true,
      inert: true,
      style: { setProperty() {}, removeProperty() {} },
    },
    status = { textContent: "" };
  let context: any,
    hold = false,
    fail = false;
  const runs: { evaluation: any; result: ReturnType<typeof deferred<any>> }[] =
    [];
  const source = localBootSource(
    [],
    {
      flow: { queries: [{ name: "rows" }], imports: [] },
      wasmBase64: "",
      tables: {},
      membersBinding: {
        backendNamespace: "legacyData",
        backendHref: "/af/v1/ids/Abcd12",
      },
    },
    undefined,
    undefined,
    false,
    [],
    [],
    undefined,
    undefined,
    [],
    { backendNamespace: "legacyData", backendHref: "/af/v1/ids/Abcd12" },
  );
  const row = (evaluation: any) => ({
    tables: {
      rows: {
        columns: [{ name: "reader", type: "string" }],
        rows: [{ reader: evaluation.userId }],
      },
    },
    errors: {},
  });
  runInNewContext(
    source
      .replace(/^import .*;\n/gm, "")
      .replace("export function boot", "function boot") + ";boot({TREE:{}});",
    {
      createCompiledMembers,
      createCompiledViewer,
      createCompiledQueryController,
      compiledQueryClock,
      AbortController,
      TextEncoder,
      Uint8Array,
      Date,
      queueMicrotask,
      atob: () => "",
      window: { addEventListener: (_name: string, fn: any) => events.push(fn) },
      document: {
        querySelector: (selector: string) =>
          selector.includes("content") ? content : status,
        createElement: () => ({
          setAttribute() {},
          dataset: {},
          after() {},
          addEventListener() {},
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
      createRoot: (fn: any) => fn(),
      createEffect: (fn: any) => fn(),
      untrack: (fn: any) => fn(),
      gql: (strings: TemplateStringsArray) => strings.join(""),
      client: {
        query: () => read.promise,
        watchQuery: ({ query }: { query: string }) => ({
          subscribe: (next: any) => {
            const name = query.includes("PageMembers")
              ? "members"
              : query.includes("viewer")
                ? "viewer"
                : "state";
            watches.set(name, next);
            if (name === "state") next({ data: { compiledPage: {} } });
            return {
              unsubscribe() {
                watches.delete(name);
              },
            };
          },
        }),
      },
      hydrateIsland: (_id: any, _tree: any, next: any) => {
        context = next;
      },
      markCompiledReady() {},
      pageEngine: () => ({
        prepare() {},
        ready: () => true,
        run: (_flow: any, _names: any, evaluation: any) => {
          if (fail) return Promise.reject(Error("engine failed"));
          if (!hold) return Promise.resolve(row(evaluation));
          const result = deferred<any>();
          runs.push({ evaluation, result });
          return result.promise;
        },
      }),
    },
  );
  return {
    content,
    status,
    runs,
    context: () => context,
    read,
    hold: () => {
      hold = true;
    },
    fail: () => {
      fail = true;
    },
    viewer: (id: string | null, generation = "b") =>
      watches.get("viewer")!({
        data: {
          legacyData: { viewer: { generation: generation.repeat(64), id } },
        },
      }),
    revoke: () =>
      watches.get("viewer")!({ data: { legacyData: { viewer: null } } }),
    memberWatch: (generation: string) =>
      watches.get("members")!({
        data: {
          legacyData: {
            members: { ...members, generation: generation.repeat(64) },
          },
        },
      }),
    complete: (index: number) =>
      runs[index]!.result.resolve(row(runs[index]!.evaluation)),
    dispose: () => events.forEach((fn) => fn({ persisted: false })),
  };
}
test("generated viewer boot waits for coherent members/query startup instead of refusing a superseded run", async () => {
  const s = setup();
  s.viewer("reader-a");
  await flush();
  assert.equal(s.content.hidden, true);
  s.read.resolve({ data: { legacyData: { members } } });
  await flush();
  assert.equal(s.content.hidden, false);
  assert.deepEqual(s.context().table("rows").rows, [{ reader: "reader-a" }]);
  s.dispose();
});
test("membership replacement during viewer application waits for its latest query", async () => {
  const s = setup();
  s.hold();
  s.viewer("reader-a");
  await flush();
  s.read.resolve({ data: { legacyData: { members } } });
  await flush();
  assert.equal(s.runs.length, 1);
  s.memberWatch("c");
  await flush();
  assert.equal(s.runs.length, 2);
  s.complete(0);
  await flush();
  assert.equal(s.content.hidden, true);
  s.complete(1);
  await flush();
  assert.equal(s.content.hidden, false);
  s.dispose();
});
test("revocation and identity switch cannot reveal a stale membership/query completion", async () => {
  const s = setup();
  s.hold();
  s.viewer("reader-a");
  await flush();
  s.read.resolve({ data: { legacyData: { members } } });
  await flush();
  s.revoke();
  s.complete(0);
  await flush();
  assert.equal(s.content.hidden, true);
  assert.equal(s.context().table("rows"), undefined);
  s.viewer("reader-b", "d");
  await flush();
  s.complete(1);
  await flush();
  assert.equal(s.content.hidden, false);
  assert.deepEqual(s.context().table("rows").rows, [{ reader: "reader-b" }]);
  s.dispose();
});
test("actual query failure and disposal keep the reader gate closed", async () => {
  const failed = setup();
  failed.fail();
  failed.viewer("reader-a");
  failed.read.resolve({ data: { legacyData: { members } } });
  await flush();
  assert.equal(failed.content.hidden, true);
  assert.match(failed.status.textContent, /unavailable/);
  failed.dispose();
  const stopped = setup();
  stopped.hold();
  stopped.viewer("reader-a");
  await flush();
  stopped.read.resolve({ data: { legacyData: { members } } });
  await flush();
  stopped.dispose();
  stopped.complete(0);
  await flush();
  assert.equal(stopped.content.hidden, true);
  assert.equal(stopped.context().table("rows"), undefined);
});

test("identity replacement during bootstrap publishes only the current viewer", async () => {
  const s = setup();
  s.hold();
  s.viewer("reader-a");
  await flush();
  s.read.resolve({ data: { legacyData: { members } } });
  await flush();
  s.viewer("reader-b", "d");
  await flush();
  s.complete(0);
  await flush();
  assert.equal(s.content.hidden, true);
  assert.equal(s.context().table("rows"), undefined);
  s.complete(1);
  await flush();
  assert.equal(s.content.hidden, false);
  assert.deepEqual(s.context().table("rows").rows, [{ reader: "reader-b" }]);
  s.dispose();
});
