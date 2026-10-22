import test from "node:test";
import assert from "node:assert/strict";
import { awaitAuthorAccess } from "../src/migration/conversion/compiled/author/access.ts";
import type { RemoteAccessSnapshot } from "../src/apollo/apollo-contracts.ts";
function fixture() {
  let current: RemoteAccessSnapshot = {
    epoch: 1,
    state: "pending",
    context: null,
  };
  const listeners = new Set<() => void>();
  return {
    options: {
      names: ["save"],
      adapter: {
        mutate: async () => ({
          affected: 1,
          rowCount: 1,
          version: 1,
          generation: 1,
        }),
      },
      authorizationContext: () => current.context,
      access: {
        read: () => current,
        subscribe: (fn: () => void) => {
          listeners.add(fn);
          return () => {
            listeners.delete(fn);
          };
        },
      },
    },
    set(next: RemoteAccessSnapshot) {
      current = next;
      for (const fn of [...listeners]) fn();
    },
    count: () => listeners.size,
  };
}
test("startup mutation waits for same-generation verified guest or signed-in access", async () => {
  const f = fixture();
  let done = false;
  const wait = awaitAuthorAccess(f.options).then((x) => {
    done = true;
    return x;
  });
  await Promise.resolve();
  assert.equal(done, false);
  f.set({ epoch: 1, state: "allowed", context: "verified-caller" });
  assert.deepEqual(await wait, { context: "verified-caller", epoch: 1 });
  assert.equal(f.count(), 0);
});
test("denial, disconnect, caller change and disposal settle pending access without leaked listeners", async () => {
  for (const state of ["denied", "disconnected", "disposed"] as const) {
    const f = fixture();
    const wait = awaitAuthorAccess(f.options);
    f.set({ epoch: 1, state, context: null });
    await assert.rejects(wait);
    assert.equal(f.count(), 0);
  }
  const f = fixture();
  const wait = awaitAuthorAccess(f.options);
  f.set({ epoch: 2, state: "allowed", context: "other" });
  await assert.rejects(wait, /caller changed/);
  assert.equal(f.count(), 0);
  const g = fixture(),
    abort = new AbortController();
  const disposed = awaitAuthorAccess(g.options, abort.signal);
  abort.abort();
  await assert.rejects(disposed, /disposed/);
  g.set({ epoch: 1, state: "allowed", context: "late" });
  assert.equal(g.count(), 0);
});
test("trusted authored transport waits before dispatch and abort never dispatches later", async () => {
  const { authorApolloPorts } = await import(
    "../src/migration/conversion/compiled/author/apollo-ports.ts"
  );
  const f = fixture();
  let calls = 0;
  f.options.adapter.mutate = async () => {
    calls++;
    return { affected: 1, rowCount: 1, version: 1, generation: 1 };
  };
  const p = authorApolloPorts(
    {} as never,
    {} as never,
    () => {
      throw Error("unused");
    },
    f.options,
  );
  const pending = p.mutation!("save", {});
  await Promise.resolve();
  assert.equal(calls, 0);
  f.set({ epoch: 1, state: "allowed", context: "ready" });
  await pending;
  assert.equal(calls, 1);
  const g = fixture();
  g.options.adapter.mutate = f.options.adapter.mutate;
  const q = authorApolloPorts(
    {} as never,
    {} as never,
    () => {
      throw Error("unused");
    },
    g.options,
  );
  const abort = new AbortController();
  const canceled = q.mutation!("save", {}, undefined, abort.signal);
  abort.abort();
  await assert.rejects(canceled);
  g.set({ epoch: 1, state: "allowed", context: "late" });
  await Promise.resolve();
  assert.equal(calls, 1);
});

test("disposing author bindings aborts an access wait and cannot dispatch after late settlement", async () => {
  const { createAuthorBindings } = await import(
    "../src/migration/conversion/compiled/author/bindings.ts"
  );
  const { authorApolloPorts } = await import(
    "../src/migration/conversion/compiled/author/apollo-ports.ts"
  );
  const f = fixture();
  let calls = 0;
  f.options.adapter.mutate = async () => {
    calls++;
    return { affected: 1, rowCount: 1, version: 1, generation: 1 };
  };
  const ports = authorApolloPorts(
    {} as never,
    {} as never,
    () => {
      throw Error("unused");
    },
    f.options,
  );
  const bindings = createAuthorBindings(
    ports,
    { values: [], queries: [], mutations: ["save"] },
    {
      identity: () => null,
      scope: (_, fn) => fn(),
      untrack: (fn) => fn(),
      signal: () => {
        throw Error("unused");
      },
    },
  );
  const pending = bindings.mutation("$save")({});
  await Promise.resolve();
  assert.equal(f.count(), 1);
  bindings.dispose();
  await assert.rejects(pending, /disposed/);
  assert.equal(f.count(), 0);
  f.set({ epoch: 1, state: "allowed", context: "late" });
  await Promise.resolve();
  assert.equal(calls, 0);
});
