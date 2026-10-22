import test from "node:test";
import assert from "node:assert/strict";
import { createClient, createLocalStore, gql } from "../src/apollo/client.ts";
import type {
  RemotePort,
  QueryResult,
} from "../src/apollo/apollo-contracts.ts";
const QUERY = gql`
  query {
    filter
    shared {
      count
    }
  }
`;
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function remoteFixture() {
  const listeners = new Set<() => void>();
  const calls: {
    resolve: (r: { data: { shared: { count: number } } }) => void;
    reject: (e: Error) => void;
  }[] = [];
  const port: RemotePort = {
    online: () => true,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    execute: () =>
      new Promise((resolve, reject) => calls.push({ resolve, reject })),
  };
  return {
    port,
    calls,
    listeners,
    changed() {
      for (const fn of [...listeners]) fn();
    },
  };
}
test("mixed watches merge fresh local fields with server results; invalidations coalesce and stale results never publish", async () => {
  const remote = remoteFixture(),
    state = createLocalStore({ filter: "first" }),
    client = createClient({ state, remote: remote.port, backends: ["shared"] });
  const results: QueryResult[] = [];
  const sub = client
    .watchQuery({ query: QUERY })
    .subscribe((r) => results.push(r));
  assert.equal(remote.calls.length, 1);
  await client.updateQuery(
    {
      query: gql`
        {
          filter
        }
      `,
    },
    () => ({ filter: "latest" }),
  );
  remote.changed();
  remote.changed();
  remote.calls[0]!.resolve({ data: { shared: { count: 1 } } });
  await tick();
  assert.equal(
    results.some(
      (r) => (r.data.shared as { count: number } | null)?.count === 1,
    ),
    false,
  );
  assert.equal(remote.calls.length, 2);
  remote.calls[1]!.resolve({ data: { shared: { count: 2 } } });
  await tick();
  assert.deepEqual(results.at(-1), {
    data: { filter: "latest", shared: { count: 2 } },
  });
  sub.unsubscribe();
  remote.changed();
  assert.equal(remote.listeners.size, 0);
  assert.equal(remote.calls.length, 2);
});
test("watch errors clear old remote data; reconnect recovers; unsubscribe/resubscribe ignores old completions", async () => {
  const remote = remoteFixture(),
    client = createClient({
      state: createLocalStore({ filter: "x" }),
      remote: remote.port,
      backends: ["shared"],
    });
  const seen: QueryResult[] = [];
  let sub = client.watchQuery({ query: QUERY }).subscribe((r) => seen.push(r));
  remote.calls[0]!.resolve({ data: { shared: { count: 1 } } });
  await tick();
  remote.changed();
  remote.calls[1]!.reject(Error("Access denied"));
  await tick();
  assert.equal(seen.at(-1)!.data.shared, null);
  assert.match(seen.at(-1)!.errors![0]!.message, /Access denied/);
  remote.changed();
  sub.unsubscribe();
  sub = client.watchQuery({ query: QUERY }).subscribe((r) => seen.push(r));
  remote.calls[2]!.resolve({ data: { shared: { count: 99 } } });
  remote.calls[3]!.resolve({ data: { shared: { count: 3 } } });
  await tick();
  assert.equal((seen.at(-1)!.data.shared as { count: number }).count, 3);
  sub.unsubscribe();
});
test("local-only watches stay synchronous and remote subscriptions have bounded ownership", () => {
  const remote = remoteFixture(),
    client = createClient({
      state: createLocalStore({ filter: "x" }),
      remote: remote.port,
      backends: ["shared"],
    });
  let current: unknown;
  const local = client
    .watchQuery({
      query: gql`
        {
          filter
        }
      `,
    })
    .subscribe((r) => (current = r.data));
  assert.deepEqual(current, { filter: "x" });
  assert.equal(remote.calls.length, 0);
  const subs = Array.from({ length: 16 }, () =>
    client.watchQuery({ query: QUERY }).subscribe(() => {}),
  );
  assert.throws(
    () => client.watchQuery({ query: QUERY }).subscribe(() => {}),
    /Too many/,
  );
  for (const sub of subs) sub.unsubscribe();
  local.unsubscribe();
  assert.equal(remote.listeners.size, 0);
});

test("server notifications refresh two viewers after a mutation without mixing their local state", async () => {
  let count = 0;
  const listeners = new Set<() => void>();
  const port: RemotePort = {
    online: () => true,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async execute(request): ReturnType<RemotePort["execute"]> {
      if (request.operation === "mutation") {
        count++;
        for (const fn of [...listeners]) fn();
        return { data: { shared: { increment: count } } };
      }
      return { data: { shared: { count } } };
    },
  };
  const clients = ["one", "two"].map((filter) =>
    createClient({
      state: createLocalStore({ filter }),
      remote: port,
      backends: ["shared"],
    }),
  );
  const seen: QueryResult[][] = [[], []];
  clients.forEach((client, i) =>
    client.watchQuery({ query: QUERY }).subscribe((r) => seen[i]!.push(r)),
  );
  await tick();
  assert.equal((seen[1]!.at(-1)!.data.shared as { count: number }).count, 0);
  await clients[0]!.mutate({
    mutation: gql`
      mutation {
        shared {
          increment
        }
      }
    `,
  });
  await tick();
  assert.deepEqual(
    seen.map((results) => results.at(-1)!.data),
    [
      { filter: "one", shared: { count: 1 } },
      { filter: "two", shared: { count: 1 } },
    ],
  );
  clients.forEach((client) => client.dispose());
  assert.equal(listeners.size, 0);
});
test("client disposal stops all owned observers and late query completions", async () => {
  const remote = remoteFixture(),
    client = createClient({
      state: createLocalStore(),
      remote: remote.port,
      backends: ["shared"],
    });
  const seen: QueryResult[] = [];
  client.watchQuery({ query: QUERY }).subscribe((r) => seen.push(r));
  client.dispose();
  client.dispose();
  remote.calls[0]!.resolve({ data: { shared: { count: 99 } } });
  await tick();
  assert.equal(seen.length, 1);
  assert.equal(remote.listeners.size, 0);
  assert.throws(
    () => client.watchQuery({ query: QUERY }).subscribe(() => {}),
    /disposed/,
  );
});
