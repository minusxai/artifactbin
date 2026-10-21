/**
 * `caps.store`: each backend file's one JSON document, kept in Postgres by
 * the platform, with compare-and-swap on a version. The store directly, then
 * through the page's GraphQL route with an in-process host that calls the
 * capability handler the route hands it (the real isolate does the same over
 * its capability bridge; see test/v2/integration/store.isolate.test.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BACKEND_STORE_LIMIT_BYTES,
  type BackendFilesModule,
  type BackendStore,
  type SqlClient,
  type SqlDatabase,
} from "../../../src/backend/af-backend-contracts.ts";
import type {
  BackendCapabilityHandler,
  BackendHost,
} from "../../../src/backend/contracts.ts";
import type { PageCaller, RemoteResponse } from "../../../src/graphql/af-namespace-contracts.ts";
import { sealDeployment } from "../../../src/backend/deployment.ts";
import { boundedBackendSchema } from "../../../src/graphql/execution-policy.ts";
import { readBackendModule } from "../../../src/backend/af-module.ts";
import { load, repositoryPath } from "../support/load.ts";
import { testDatabase } from "../../postgres.js";

async function setup() {
  const db = await testDatabase();
  await db.pool.query(await readFile(repositoryPath("src/backend/af-schema.sql"), "utf8"));
  const database: SqlDatabase = {
    async transaction(work) {
      const client = await db.pool.connect();
      try {
        await client.query("BEGIN");
        const value = await work(client as SqlClient);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
  const backendFile = (id: string) =>
    db.pool.query("INSERT INTO af_backend_files (file_id, owner, head_version) VALUES ($1, 'owner', 'v')", [id]);
  const { createBackendStore } = await load<{ createBackendStore(database: SqlDatabase): BackendStore }>(
    "src/backend/af-store.ts",
  );
  return { db, database, backendFile, store: createBackendStore(database) };
}

test("a backend file's store starts empty and changes only from the version it was read at", async () => {
  const { db, backendFile, store } = await setup();
  try {
    await backendFile("Td0001");
    await backendFile("Td0002");
    assert.deepEqual(await store.get("Td0001"), { value: null, version: 0 });
    assert.deepEqual(await store.set("Td0001", { todos: ["a"] }, 0), { version: 1 });
    assert.deepEqual(await store.get("Td0001"), { value: { todos: ["a"] }, version: 1 });
    // A writer that read before that change gets a conflict, and nothing changes.
    assert.deepEqual(await store.set("Td0001", { todos: ["b"] }, 0), { conflict: true, version: 1 });
    assert.deepEqual(await store.set("Td0001", { todos: ["b"] }, 7), { conflict: true, version: 1 });
    assert.deepEqual(await store.get("Td0001"), { value: { todos: ["a"] }, version: 1 });
    assert.deepEqual(await store.set("Td0001", { todos: ["a", "b"] }, 1), { version: 2 });
    // Each backend file has its own document.
    assert.deepEqual(await store.get("Td0002"), { value: null, version: 0 });
    // Concurrent writers from the same version: exactly one wins.
    const results = await Promise.all(
      ["x", "y", "z"].map((name) => store.set("Td0001", { todos: [name] }, 2)),
    );
    assert.equal(results.filter((r) => !("conflict" in r)).length, 1);
    assert.equal((await store.get("Td0001")).version, 3);
  } finally {
    await db.cleanup();
  }
});

test("store documents are limited to 60 KB of JSON, and versions must be whole numbers", async () => {
  const { db, backendFile, store } = await setup();
  try {
    await backendFile("Td0003");
    const fits = { text: "x".repeat(BACKEND_STORE_LIMIT_BYTES - 20) };
    assert.deepEqual(await store.set("Td0003", fits, 0), { version: 1 });
    await assert.rejects(
      store.set("Td0003", { text: "x".repeat(BACKEND_STORE_LIMIT_BYTES) }, 1),
      /60 KB/,
    );
    await assert.rejects(store.set("Td0003", { a: 1 }, -1), TypeError);
    await assert.rejects(store.set("Td0003", { a: 1 }, 1.5), TypeError);
    assert.equal((await store.get("Td0003")).version, 1);
  } finally {
    await db.cleanup();
  }
});

/** In-process host whose resolvers use caps.store through the handler the route passes. */
function storeHost(): BackendHost {
  return {
    async compile(source) {
      const { typeDefs } = await readBackendModule(source);
      const schema = boundedBackendSchema(typeDefs);
      const fields = [
        ...Object.keys(schema.getQueryType()?.getFields() ?? {}),
        ...Object.keys(schema.getMutationType()?.getFields() ?? {}),
      ];
      return sealDeployment(source, `bundle for ${source.length}`, { typeDefs, fields });
    },
    async invoke({ deployment: _deployment, principal, input, signal, capabilityHandler: handler }) {
      if (!handler) throw Error("no capability handler");
      const call = (request: Parameters<BackendCapabilityHandler>[1]) =>
        handler(principal, request, signal ?? new AbortController().signal);
      const read = async () => (await call({ kind: "store", operation: "get" })) as { value: { todos: string[] } | null; version: number };
      if (input.field === "todos") return (await read()).value?.todos ?? [];
      if (input.field === "connector")
        return call({ kind: "invoke", resource: "db", operation: "x", input: null }).then(
          () => "allowed",
          () => "denied",
        );
      // add: read, then (once) write from a stale version, see the conflict, re-read and retry.
      const { text } = input.args as { text: string };
      let stale = text === "stale";
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = await read();
        const expected = stale ? current.version - 1 : current.version;
        stale = false;
        const written = (await call({
          kind: "store",
          operation: "set",
          value: { todos: [...(current.value?.todos ?? []), text] },
          expected,
        })) as { conflict?: true; version: number };
        if (!written.conflict) return [...(current.value?.todos ?? []), text];
      }
      throw Error("gave up");
    },
  };
}

test("resolvers share one store across viewers, including anonymous ones, and retry a conflict", async () => {
  const { db, database } = await setup();
  try {
    const { createBackendFiles, createBackendRoutes } = await load<BackendFilesModule>("src/backend/af-files.ts");
    const host = storeHost();
    const files = createBackendFiles({ host });
    const source = `export const typeDefs = 'type Query { todos: [String!]!  connector: String } type Mutation { add(text: String!): [String!]! }';
export default { Query: { todos: () => [], connector: () => null }, Mutation: { add: () => [] } };
`;
    const compiled = await files.compile({ Td0004: source });
    await database.transaction((c) =>
      files.record(c, {
        owner: "owner@example.test",
        pageId: "Pg4mQ2",
        pageVersion: 1,
        links: [{ name: "todos", href: "https://artifactbin.dev/af/v1/ids/Td0004", id: "Td0004", line: 4 }],
        compiled,
      }),
    );
    const callers: Record<string, Omit<PageCaller, "pageId">> = {
      owner: { subject: "owner@example.test", role: "OWNER" },
      "": { subject: null, role: "VIEWER" },
    };
    const routes = createBackendRoutes({
      database,
      host,
      caller: async (_client, pageId, credential) => ({ pageId, ...callers[credential]! }),
    });
    const graphql = async (credential: string, query: string) =>
      (
        await routes.handle({
          method: "POST",
          url: new URL("http://pagegi.test/api/files/Pg4mQ2/graphql"),
          credential,
          body: { query } as never,
          signal: new AbortController().signal,
        })
      )!.body as RemoteResponse;

    const first = await graphql("owner", 'mutation { todos { add(text: "Milk") } }');
    assert.deepEqual(first.data, { todos: { add: ["Milk"] } });
    assert.deepEqual(first.extensions?.outcomes, { "todos.add": "committed" });
    // An anonymous viewer reaches the same document.
    assert.deepEqual((await graphql("", "{ todos { todos } }")).data, { todos: { todos: ["Milk"] } });
    const anonymous = await graphql("", 'mutation { todos { add(text: "stale") } }');
    assert.deepEqual(anonymous.data, { todos: { add: ["Milk", "stale"] } }, "the conflict was retried");
    assert.deepEqual((await graphql("owner", "{ todos { todos } }")).data, { todos: { todos: ["Milk", "stale"] } });
    // The store is the only capability without an operator's connectors.
    assert.deepEqual((await graphql("owner", "{ todos { connector } }")).data, { todos: { connector: "denied" } });
  } finally {
    await db.cleanup();
  }
});
