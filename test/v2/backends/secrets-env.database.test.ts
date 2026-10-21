/**
 * A backend call carries the backend FILE OWNER's secrets as `env`: not the
 * page owner's, not the caller's, and `{}` when the owner has none (contract:
 * src/server/secrets-contracts.ts, BackendHost.invoke in src/backend/contracts.ts).
 * Postgres with an in-process fake host that records what it was handed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { BackendFilesModule, SqlClient, SqlDatabase } from "../../../src/backend/af-backend-contracts.ts";
import type { BackendEnv, BackendExecutionScope, BackendHost, CompiledBackend } from "../../../src/backend/contracts.ts";
import { BackendHostError } from "../../../src/backend/contracts.ts";
import type { PageCaller, RemoteResponse } from "../../../src/graphql/af-namespace-contracts.ts";
import type { BackendsResponse } from "../../../src/backend/af-backend-contracts.ts";
import { sealDeployment } from "../../../src/backend/deployment.ts";
import { boundedBackendSchema } from "../../../src/graphql/execution-policy.ts";
import { readBackendModule } from "../../../src/backend/af-module.ts";
import { load, repositoryPath } from "../support/load.ts";
import { testDatabase } from "../../postgres.js";

const FILE = (field: string) => `import { gql } from '@afbin/apollo';
export const typeDefs = gql\`type Query { ${field}: String }\`;
export default { Query: { ${field}: (a, p, caps, env) => env.STRIPE_KEY ?? null } };
`;

function recordingHost() {
  const calls: { field: string; env: BackendEnv | undefined; subject: string | null; scope: BackendExecutionScope | undefined }[] = [];
  const host: BackendHost = {
    async compile(source) {
      const { typeDefs } = await readBackendModule(source);
      const schema = boundedBackendSchema(typeDefs);
      return sealDeployment(source, `bundle for ${source.length}`, {
        typeDefs,
        fields: Object.keys(schema.getQueryType()?.getFields() ?? {}),
      });
    },
    async invoke({ deployment, principal, input, signal: _signal, capabilityHandler: _caps, env, reuse }) { const scope = reuse.kind === "file" ? reuse.scope : undefined;
      if (!deployment.fields.includes(input.field)) throw new BackendHostError("field_rejected");
      calls.push({ field: input.field, env, subject: principal.subject, scope });
      return env?.STRIPE_KEY ?? null;
    },
  };
  return { host, calls };
}

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
  return { db, database };
}

const ALICE = "alice@example.test",
  BOB = "bob@example.test",
  CAROL = "carol@example.test";
const ALICE_PAGE = "Pa1aaa",
  BOB_PAGE = "Pb2bbb";
const ALICE_FILE = "Fa1aaa",
  BOB_FILE = "Fb2bbb";
const link = (name: string, id: string, line: number) => ({ name, id, href: `https://artifactbin.dev/af/v1/ids/${id}`, line });
const callers: Record<string, Omit<PageCaller, "pageId">> = {
  [BOB]: { subject: BOB, role: "OWNER" },
  [CAROL]: { subject: CAROL, role: "VIEWER" },
  "": { subject: null, role: "VIEWER" },
};

test("a lambda's env is its file owner's secrets, loaded per request; a page may link files of several owners", async () => {
  const { db, database } = await setup();
  try {
    const { createBackendFiles, createBackendRoutes } = await load<BackendFilesModule>("src/backend/af-files.ts");
    const { host, calls } = recordingHost();
    const files = createBackendFiles({ host });
    // Alice publishes her file with her own page; Bob's page links Alice's file and his own.
    const alices = await files.compile({ [ALICE_FILE]: FILE("alicesField") });
    await database.transaction((c) =>
      files.record(c, { owner: ALICE, pageId: ALICE_PAGE, pageVersion: 1, links: [link("mine", ALICE_FILE, 4)], compiled: alices }),
    );
    const bobs = await files.compile({ [BOB_FILE]: FILE("bobsField") });
    await database.transaction((c) =>
      files.record(c, {
        owner: BOB,
        pageId: BOB_PAGE,
        pageVersion: 1,
        links: [link("alice", ALICE_FILE, 4), link("bob", BOB_FILE, 5)],
        compiled: bobs,
      }),
    );
    const envs: Record<string, Record<string, string>> = {
      [ALICE]: { STRIPE_KEY: "sk_alice", OTHER: "a" },
      [CAROL]: { STRIPE_KEY: "sk_carol" },
    };
    const owners: string[] = [];
    const routes = createBackendRoutes({
      database,
      host,
      caller: async (_c, pageId, credential) => ({ pageId, ...(callers[credential] ?? { subject: credential, role: null }) }),
      secrets: async (_client, owner) => {
        owners.push(owner);
        return envs[owner] ?? {};
      },
      log: () => {},
    });
    const call = async (method: string, path: string, credential: string, body: Record<string, unknown> = {}) =>
      (await routes.handle({ method, url: new URL(`http://pagegi.test${path}`), credential, body: body as never, signal: new AbortController().signal }))!;
    // Carol, signed in with secrets of her own, calls both of Bob's page's backends.
    const listed = (await call("GET", `/api/files/${BOB_PAGE}/backends`, CAROL)).body as BackendsResponse;
    assert.deepEqual(listed.backends.map((b) => b.name), ["alice", "bob"]);
    const response = (await call("POST", `/api/files/${BOB_PAGE}/graphql`, CAROL, { query: "{ alice { alicesField } bob { bobsField } }", scope: { owner: CAROL, fileId: BOB_FILE } })).body as RemoteResponse;
    assert.deepEqual(response, { data: { alice: { alicesField: "sk_alice" }, bob: { bobsField: null } } });
    assert.deepEqual(calls, [
      { field: "alicesField", env: { STRIPE_KEY: "sk_alice", OTHER: "a" }, subject: CAROL, scope: { owner: ALICE, fileId: ALICE_FILE } },
      { field: "bobsField", env: {}, subject: CAROL, scope: { owner: BOB, fileId: BOB_FILE } },
    ]);
    assert.deepEqual(owners.sort(), [ALICE, BOB], "each linked file's owner, once per request; never the caller");

    // Anonymous callers get the same env: it is the owner's, not the viewer's.
    calls.length = 0;
    const anonymous = (await call("POST", `/api/files/${BOB_PAGE}/graphql`, "", { query: "{ alice { alicesField } }" })).body as RemoteResponse;
    assert.deepEqual(anonymous.data, { alice: { alicesField: "sk_alice" } });
    assert.deepEqual(calls.map((c) => c.env), [{ STRIPE_KEY: "sk_alice", OTHER: "a" }]);
    assert.deepEqual(calls.map((c) => c.scope), [{ owner: ALICE, fileId: ALICE_FILE }], "anonymous viewers use stored file ownership too");

    // The next request sees a change at once: env is read per request, not cached with the deployment.
    envs[ALICE] = { STRIPE_KEY: "sk_rotated" };
    const rotated = (await call("POST", `/api/files/${BOB_PAGE}/graphql`, CAROL, { query: "{ alice { alicesField } }" })).body as RemoteResponse;
    assert.deepEqual(rotated.data, { alice: { alicesField: "sk_rotated" } });

    // A server without secrets still passes an env, and it is empty.
    const plain = createBackendRoutes({
      database,
      host,
      caller: async (_c, pageId, credential) => ({ pageId, ...(callers[credential] ?? { subject: credential, role: null }) }),
      log: () => {},
    });
    calls.length = 0;
    const none = await plain.handle({
      method: "POST",
      url: new URL(`http://pagegi.test/api/files/${BOB_PAGE}/graphql`),
      credential: CAROL,
      body: { query: "{ alice { alicesField } }" } as never,
      signal: new AbortController().signal,
    });
    assert.deepEqual((none!.body as RemoteResponse).data, { alice: { alicesField: null } });
    assert.deepEqual(calls.map((c) => c.env), [{}]);
  } finally {
    await db.cleanup();
  }
});
