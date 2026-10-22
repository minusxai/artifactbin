/**
 * Backend versions and the page's GraphQL route over Postgres,
 * with an in-process host and a fake caller (brief C; no Docker, no server).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type {
  BackendFilesModule,
  BackendsResponse,
  SqlClient,
  SqlDatabase,
} from "../../../src/backend/af-backend-contracts.ts";
import type {
  PageCaller,
  RemoteResponse,
} from "../../../src/graphql/af-namespace-contracts.ts";
import type { AfRouteModule } from "../../../src/server/af-api-contracts.ts";
import type {
  BackendHost,
  BackendJson,
  CompiledBackend,
} from "../../../src/backend/contracts.ts";
import { BackendHostError } from "../../../src/backend/contracts.ts";
import {
  isCurrentRuntime,
  sealDeployment,
  verifyDeployment,
} from "../../../src/backend/deployment.ts";
import { boundedBackendSchema } from "../../../src/graphql/execution-policy.ts";
import { readBackendModule } from "../../../src/backend/af-module.ts";
import { load, repositoryPath } from "../support/load.ts";
import { testDatabase } from "../../postgres.js";

const LEDGER = (greeting: string) => `import { gql } from '@afbin/apollo';
export const typeDefs = gql\`
  type Entry { note: String!  by: String }
  type Query { whoami: String  greeting: String! }
  type Mutation { record(note: String!): Entry! @auth(role: EDITOR)  busy: Entry  crash: Entry  huge: Entry }
\`;
export default { Query: {}, Mutation: {} }; // ${greeting}
`;
const NOTES =
  "export const typeDefs = 'type Entry { id: ID! } type Query { list: [Entry!]! }';\nexport default { Query: {} };\n";

/** Runs resolvers in-process by field name; the real host runs the same contract in a container. */
function fakeHost() {
  const calls: { field: string; subject: string | null; tenant: string }[] = [];
  const host: BackendHost = {
    async compile(source) {
      const { typeDefs } = await readBackendModule(source);
      const schema = boundedBackendSchema(typeDefs);
      const fields = [
        ...Object.keys(schema.getQueryType()?.getFields() ?? {}),
        ...Object.keys(schema.getMutationType()?.getFields() ?? {}),
      ];
      return sealDeployment(source, `bundle for ${source.length}`, {
        typeDefs,
        fields,
      });
    },
    async invoke({ deployment, principal, input }) {
      calls.push({
        field: input.field,
        subject: principal.subject,
        tenant: principal.tenant,
      });
      const args = input.args as Record<string, BackendJson>;
      switch (input.field) {
        case "whoami":
          return principal.subject;
        case "greeting":
          return /\/\/ (\w+)/.exec(deployment.source)![1]!;
        case "record":
          return { note: args.note!, by: principal.subject };
        case "busy":
          throw new BackendHostError("backend_busy");
        case "crash":
          throw new BackendHostError("backend_rejected", "boom at line 3\n    at crash (backend.ts:3:9)");
        case "huge":
          throw new BackendHostError("store_limit", "The store document is limited to 60 KB of JSON");
        case "list":
          return [{ id: "1" }];
      }
      throw new BackendHostError("field_rejected");
    },
  };
  return { host, calls };
}

const callers: Record<string, Omit<PageCaller, "pageId">> = {
  owner: { subject: "owner@example.test", role: "OWNER" },
  editor: { subject: "ed@example.test", role: "EDITOR" },
  viewer: { subject: "viewer@example.test", role: "VIEWER" },
  "": { subject: null, role: "VIEWER" },
  stranger: { subject: "eve@example.test", role: null },
};

async function setup() {
  const db = await testDatabase();
  await db.pool.query(
    await readFile(repositoryPath("src/backend/af-schema.sql"), "utf8"),
  );
  // Re-running the schema file is harmless: the server runs it on every start.
  await db.pool.query(
    await readFile(repositoryPath("src/backend/af-schema.sql"), "utf8"),
  );
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

const PAGE = "Pg4mQ2";
const LEDGER_ID = "Ld9xK2";
const NOTES_ID = "Nt3pQ7";
const links = [
  {
    name: "ledger",
    href: `https://artifactbin.dev/af/v1/ids/${LEDGER_ID}`,
    id: LEDGER_ID,
    line: 4,
  },
  {
    name: "notes",
    href: `https://artifactbin.dev/af/v1/ids/${NOTES_ID}`,
    id: NOTES_ID,
    line: 5,
  },
];

function client(routes: AfRouteModule) {
  const call = async (
    method: string,
    path: string,
    credential: string,
    body: Record<string, unknown> = {},
  ) => {
    const response = await routes.handle({
      method,
      url: new URL(`http://pagegi.test${path}`),
      credential,
      body: body as never,
      signal: new AbortController().signal,
    });
    assert.ok(response, `${path} is a backend route`);
    return response;
  };
  return {
    call,
    list: async (credential: string) =>
      (await call("GET", `/api/files/${PAGE}/backends`, credential))
        .body as BackendsResponse,
    graphql: async (credential: string, query: string) =>
      (await call("POST", `/api/files/${PAGE}/graphql`, credential, { query }))
        .body as RemoteResponse,
  };
}

test("published backend versions are listed and called under their names by every viewer who can open the page", async () => {
  const { db, database } = await setup();
  try {
    const { createBackendFiles, createBackendRoutes } =
      await load<BackendFilesModule>("src/backend/af-files.ts");
    const { host, calls } = fakeHost();
    const files = createBackendFiles({ host });
    const compiled = await files.compile({
      [LEDGER_ID]: LEDGER("hi"),
      [NOTES_ID]: NOTES,
    });
    await database.transaction((c) =>
      files.record(c, {
        owner: "owner@example.test",
        pageId: PAGE,
        pageVersion: 1,
        links,
        compiled,
      }),
    );
    assert.deepEqual(
      await database.transaction((c) =>
        files.owned(c, "owner@example.test", [LEDGER_ID, "Zz0000"]),
      ),
      [LEDGER_ID],
    );
    assert.deepEqual(
      await database.transaction((c) =>
        files.owned(c, "viewer@example.test", [LEDGER_ID]),
      ),
      [],
    );
    assert.deepEqual(
      await database.transaction((c) =>
        files.published(c, [NOTES_ID, "Zz0000"]),
      ),
      [NOTES_ID],
    );

    const routes = createBackendRoutes({
      database,
      host,
      caller: async (_client, pageId, credential) => ({
        pageId,
        ...callers[credential]!,
      }),
    });
    const api = client(routes);
    assert.equal(
      await routes.handle({
        method: "GET",
        url: new URL("http://pagegi.test/api/files/Pg4mQ2/source"),
        credential: "",
        body: {},
        signal: new AbortController().signal,
      }),
      null,
    );
    assert.equal(
      (await api.call("POST", `/api/files/${PAGE}/backends`, "owner")).status,
      405,
    );

    const owned = await api.list("owner");
    assert.deepEqual(
      owned.backends.map(({ name, id }) => ({ name, id })),
      [
        { name: "ledger", id: LEDGER_ID },
        { name: "notes", id: NOTES_ID },
      ],
    );
    assert.match(
      owned.backends[0]!.typeDefs,
      /type Entry \{ note: String!  by: String \}/,
    );
    assert.deepEqual(
      (
        await api.graphql(
          "owner",
          "{ ledger { whoami greeting } notes { list { id } } }",
        )
      ).data,
      {
        ledger: { whoami: "owner@example.test", greeting: "hi" },
        notes: { list: [{ id: "1" }] },
      },
    );
    assert.ok(calls.every((call) => call.tenant === PAGE));

    // A signed-in viewer's calls run at once; there is no approval step or route.
    const before = await api.list("viewer");
    assert.deepEqual(before.backends, owned.backends);
    assert.deepEqual(
      Object.keys(before.backends[0]!).sort(),
      ["id", "name", "typeDefs", "version"],
    );
    assert.equal(
      await routes.handle({
        method: "POST",
        url: new URL(`http://pagegi.test/api/files/${PAGE}/backends/approve`),
        credential: "viewer",
        body: { versions: before.backends.map((b) => b.version) },
        signal: new AbortController().signal,
      }),
      null,
    );
    assert.deepEqual(
      (await api.graphql("viewer", "{ ledger { whoami } }")).data,
      { ledger: { whoami: "viewer@example.test" } },
    );
    const viewerWrite = await api.graphql(
      "viewer",
      'mutation { ledger { record(note: "x") { note } } }',
    );
    assert.deepEqual(viewerWrite.extensions?.outcomes, {
      "ledger.record": "rejected",
    });

    // Anonymous viewers too; their principal has no subject.
    assert.deepEqual((await api.list("")).backends, owned.backends);
    assert.deepEqual((await api.graphql("", "{ ledger { whoami } }")).data, {
      ledger: { whoami: null },
    });
    // Someone who cannot open the page learns nothing.
    assert.equal(
      (await api.call("GET", `/api/files/${PAGE}/backends`, "stranger")).status,
      404,
    );
    assert.equal(
      (
        await api.call("POST", `/api/files/${PAGE}/graphql`, "stranger", {
          query: "{ ledger { whoami } }",
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await api.call("POST", `/api/files/${PAGE}/graphql`, "owner", {
          query: 7,
        })
      ).status,
      400,
    );

    // Host failures settle by whether the resolver could have run.
    const settled = await api.graphql(
      "owner",
      'mutation { ledger { busy { note } crash { note } record(note: "ok") { by } } }',
    );
    assert.deepEqual(settled.extensions?.outcomes, {
      "ledger.busy": "rejected",
      "ledger.crash": "unknown",
      "ledger.record": "committed",
    });
    assert.deepEqual(settled.data, {
      ledger: { busy: null, crash: null, record: { by: "owner@example.test" } },
    });

    // Saving a changed file makes a new version; the unchanged one keeps its version.
    const changed = await files.compile({ [LEDGER_ID]: LEDGER("hello") });
    await database.transaction((c) =>
      files.record(c, {
        owner: "owner@example.test",
        pageId: PAGE,
        pageVersion: 2,
        links,
        compiled: changed,
      }),
    );
    const after = await api.list("viewer");
    assert.notEqual(after.backends[0]!.version, before.backends[0]!.version);
    assert.equal(after.backends[1]!.version, before.backends[1]!.version);
    assert.deepEqual(
      (await api.graphql("viewer", "{ ledger { greeting } }")).data,
      { ledger: { greeting: "hello" } },
    );

    // Another account cannot publish over a file it does not own; nothing is recorded.
    await assert.rejects(
      database.transaction((c) =>
        files.record(c, {
          owner: "eve@example.test",
          pageId: "Ev1lPg",
          pageVersion: 1,
          links,
          compiled: changed,
        }),
      ),
      new RegExp(LEDGER_ID),
    );
    // A save that drops every link leaves the page with no backends.
    await database.transaction((c) =>
      files.record(c, {
        owner: "owner@example.test",
        pageId: PAGE,
        pageVersion: 3,
        links: [],
        compiled: {},
      }),
    );
    assert.deepEqual((await api.list("owner")).backends, []);
  } finally {
    await db.cleanup();
  }
});

test("a file that breaks the rules is refused naming its ID, before the host is asked", async () => {
  const { createBackendFiles } = await load<BackendFilesModule>(
    "src/backend/af-files.ts",
  );
  const { host, calls } = fakeHost();
  let compiles = 0;
  const files = createBackendFiles({
    host: { ...host, compile: (source) => (compiles++, host.compile(source)) },
  });
  await assert.rejects(files.compile({ Bad000: "export default {};" }), {
    name: "BackendModuleError",
    message: /^Bad000: /,
  });
  await assert.rejects(
    files.compile({ Bad001: "import x from './helper';\n" + NOTES }),
    { problem: "import-not-allowed" },
  );
  assert.equal(compiles, 0);
  assert.equal(calls.length, 0);
  await assert.rejects(createBackendFiles({}).compile({ NoHst0: NOTES }), {
    name: "BackendHostError",
    message: /NoHst0/,
  });
});

/** Publish LEDGER and NOTES on PAGE as the owner. */
async function publishBoth(
  database: SqlDatabase,
  host: BackendHost,
  log: string[],
) {
  const { createBackendFiles, createBackendRoutes } =
    await load<BackendFilesModule>("src/backend/af-files.ts");
  const files = createBackendFiles({ host });
  const compiled = await files.compile({
    [LEDGER_ID]: LEDGER("hi"),
    [NOTES_ID]: NOTES,
  });
  await database.transaction((c) =>
    files.record(c, {
      owner: "owner@example.test",
      pageId: PAGE,
      pageVersion: 1,
      links,
      compiled,
    }),
  );
  const api = client(
    createBackendRoutes({
      database,
      host,
      caller: async (_client, pageId, credential) => ({
        pageId,
        ...callers[credential]!,
      }),
      log: (line) => log.push(line),
    }),
  );
  const listed = await api.list("viewer");
  return { api, versions: listed.backends.map((b) => b.version) };
}

const OLD_RUNTIME =
  "workerd@1.0.0/esbuild@0.1.0/protocol@2/image:sha256:" + "a".repeat(64);
type TestDb = Awaited<ReturnType<typeof setup>>["db"];

/** Make the stored LEDGER deployment look compiled by an older runtime generation. */
async function ageLedger(db: TestDb) {
  await db.pool.query(
    `UPDATE af_backend_versions SET deployment = jsonb_set(deployment, '{runtime}', to_jsonb($2::text))
      WHERE file_id = $1`,
    [LEDGER_ID, OLD_RUNTIME],
  );
}

async function storedRuntimes(db: TestDb) {
  const { rows } = await db.pool.query(
    `SELECT deployment->>'runtime' AS runtime FROM af_backend_versions WHERE file_id = $1`,
    [LEDGER_ID],
  );
  return rows.map((row: { runtime: string }) => String(row.runtime));
}

test("a failed backend call names its code to the page, tells the owner alone what it said, and logs one line without source", async () => {
  const { db, database } = await setup();
  try {
    const { host } = fakeHost();
    const log: string[] = [];
    const { api } = await publishBoth(database, host, log);
    const mutation =
      'mutation { ledger { busy { note } crash { note } huge { note } record(note: "ok") { by } } }';
    const settled = await api.graphql("owner", mutation);
    assert.deepEqual(settled.extensions?.outcomes, {
      "ledger.busy": "rejected",
      "ledger.crash": "unknown",
      "ledger.huge": "rejected",
      "ledger.record": "committed",
    });
    assert.deepEqual(
      settled.errors?.map(({ message, path, extensions }) => ({
        message,
        path,
        extensions,
      })),
      [
        {
          message: "Backend request rejected before execution",
          path: ["ledger", "busy"],
          extensions: { code: "backend_busy" },
        },
        {
          message: "Backend execution failed",
          path: ["ledger", "crash"],
          extensions: { code: "backend_rejected", detail: "boom at line 3" },
        },
        {
          message: "Backend request rejected before execution",
          path: ["ledger", "huge"],
          extensions: {
            code: "store_limit",
            detail: "The store document is limited to 60 KB of JSON",
          },
        },
      ],
    );
    assert.deepEqual(log, [
      `backend call failed page=${PAGE} backend=${LEDGER_ID} field=busy code=backend_busy`,
      `backend call failed page=${PAGE} backend=${LEDGER_ID} field=crash code=backend_rejected`,
      `backend call failed page=${PAGE} backend=${LEDGER_ID} field=huge code=store_limit`,
    ]);
    // A signed-in viewer and an anonymous viewer get the codes alone.
    for (const who of ["viewer", ""]) {
      const theirs = await api.graphql(who, "mutation { ledger { crash { note } huge { note } } }");
      assert.deepEqual(
        theirs.errors?.map((error) => error.extensions),
        [{ code: "backend_rejected" }, { code: "store_limit" }],
        who,
      );
    }
  } finally {
    await db.cleanup();
  }
});

test("a backend stored for an older runtime is recompiled on first use, keeping its version", async () => {
  const { db, database } = await setup();
  try {
    const { host, calls } = fakeHost();
    let compiles = 0;
    const invoked: CompiledBackend[] = [];
    const strict: BackendHost = {
      compile: (source, signal) => (compiles++, host.compile(source, signal)),
      // Like the container host: only a deployment for the current runtime runs.
      invoke(request) {
        const { deployment } = request;
        verifyDeployment(deployment);
        invoked.push(deployment);
        return host.invoke(request);
      },
    };
    const log: string[] = [];
    const { api, versions } = await publishBoth(database, strict, log);
    await ageLedger(db);
    compiles = 0;
    const ran = calls.length;

    // Two viewers arriving together share one recompile.
    const [first, second] = await Promise.all([
      api.graphql("viewer", "{ ledger { greeting whoami } }"),
      api.graphql("owner", "{ ledger { greeting } }"),
    ]);
    assert.deepEqual(first.data, {
      ledger: { greeting: "hi", whoami: "viewer@example.test" },
    });
    assert.deepEqual(second.data, { ledger: { greeting: "hi" } });
    assert.equal(compiles, 1);
    assert.equal(calls.length, ran + 3);
    assert.ok(invoked.every((d) => isCurrentRuntime(d.runtime)));
    assert.ok(
      (await storedRuntimes(db)).every(isCurrentRuntime),
      "the recompiled deployment is stored",
    );

    // The version viewers call is unchanged.
    const after = await api.list("viewer");
    assert.deepEqual(
      after.backends.map((b) => b.version),
      versions,
    );
    await api.graphql("viewer", "{ ledger { whoami } }");
    assert.equal(compiles, 1, "later calls use the stored deployment");
    assert.deepEqual(log, [
      `backend runtime upgraded page=${PAGE} backend=${LEDGER_ID} version=${versions[0]}`,
    ]);
  } finally {
    await db.cleanup();
  }
});

test("a backend whose recompile fails settles rejected with a clear code", async () => {
  const { db, database } = await setup();
  try {
    const { host, calls } = fakeHost();
    let refuse: BackendHostError | null = null;
    const flaky: BackendHost = {
      compile: (source, signal) =>
        refuse ? Promise.reject(refuse) : host.compile(source, signal),
      invoke: (...args) => host.invoke(...args),
    };
    const log: string[] = [];
    const { api } = await publishBoth(database, flaky, log);
    await ageLedger(db);
    const ran = calls.length;

    refuse = new BackendHostError("build_rejected");
    const failed = await api.graphql(
      "owner",
      'mutation { ledger { record(note: "x") { note } } }',
    );
    assert.deepEqual(failed.extensions?.outcomes, {
      "ledger.record": "rejected",
    });
    assert.deepEqual(failed.errors?.[0], {
      message: "Backend request rejected before execution",
      path: ["ledger", "record"],
      extensions: { code: "recompile_failed" },
    });

    // A busy executor is a reason to try again, not a broken backend.
    refuse = new BackendHostError("backend_busy");
    const busy = await api.graphql("owner", "{ ledger { greeting } }");
    assert.deepEqual(busy.errors?.[0]?.extensions, { code: "backend_busy" });

    assert.equal(calls.length, ran, "nothing ran on the stale deployment");
    assert.deepEqual(await storedRuntimes(db), [OLD_RUNTIME]);
    assert.deepEqual(log, [
      `backend call failed page=${PAGE} backend=${LEDGER_ID} field=record code=recompile_failed`,
      `backend call failed page=${PAGE} backend=${LEDGER_ID} field=greeting code=backend_busy`,
    ]);

    // Once the executor recovers, the next call upgrades and runs.
    refuse = null;
    assert.deepEqual(
      (await api.graphql("owner", "{ ledger { greeting } }")).data,
      { ledger: { greeting: "hi" } },
    );
  } finally {
    await db.cleanup();
  }
});

test("a proven dataset refusal is rejected at GraphQL while a dispatched transport failure stays unknown", async () => {
  const { db, database } = await setup();
  try {
    const { host } = fakeHost();
    const original = host.invoke;
    host.invoke = async (call) => {
      if (call.input.field === "huge") {
        const { BackendDatasetMutationRejectedError } = await import(
          "../../../src/backend/contracts.ts"
        );
        throw new BackendDatasetMutationRejectedError();
      }
      return original(call);
    };
    const { api } = await publishBoth(database, host, []);
    const result = await api.graphql(
      "owner",
      "mutation { ledger { huge { note } crash { note } } }",
    );
    assert.deepEqual(result.extensions?.outcomes, {
      "ledger.huge": "rejected",
      "ledger.crash": "unknown",
    });
    assert.equal(
      result.errors?.[0]?.extensions?.code,
      "dataset_mutation_rejected",
    );
  } finally {
    await db.cleanup();
  }
});
