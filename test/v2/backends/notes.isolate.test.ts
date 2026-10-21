/**
 * The skill's notes example against a real database: its backend reaches
 * Postgres only through the two operations an operator connected to the page
 * as the `demo-db` resource, each page sees only its own rows, viewers who
 * aren't signed in are refused, and the resolver's validation holds. Needs
 * Postgres and `npm run build:backend`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBackendHost } from "../../../src/backend/container-host.ts";
import { withCapabilityAuthority } from "../../../src/backend/capability-authority.ts";
import { configureResources } from "../../../src/connectors/config.ts";
import type { BackendHost } from "../../../src/backend/contracts.ts";
import type { BackendsResponse } from "../../../src/backend/af-backend-contracts.ts";
import type { RemoteResponse } from "../../../src/graphql/af-namespace-contracts.ts";
import { publishNotes } from "../support/notes.ts";
import { startServer } from "../support/server.ts";

/** The demo table, as production's pagegi_demo.notes, in the test's own schema. */
const NOTES_TABLE = `CREATE TABLE notes (
  tenant text NOT NULL,
  id text NOT NULL,
  text text NOT NULL CHECK (length(text) >= 1 AND length(text) <= 500),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant, id)
)`;

/** Production's `demo-db` operations and parameters; only the table's schema differs. */
const DEMO_DB = {
  kind: "postgres",
  connectionStringEnv: "PAGEGI_DEMO_DATABASE_URL",
  operations: {
    listNotes: {
      text: "SELECT id,text FROM notes WHERE tenant=$1 ORDER BY created_at,id",
      params: [{ from: "tenant" }],
    },
    addNote: {
      text: "INSERT INTO notes(tenant,id,text) VALUES($1,$2,$3) ON CONFLICT(tenant,id) DO NOTHING RETURNING id,text",
      params: [{ from: "tenant" }, { from: "input", path: ["id"] }, { from: "input", path: ["text"] }],
    },
  },
};

test("the notes example reads and writes Postgres through the operator's demo-db operations, one tenant per page", async () => {
  // A grant names a page ID and a backend version, both known only once the page
  // is published: the server starts without grants and gets them then.
  const sandbox = createBackendHost({});
  let current: BackendHost = sandbox;
  const host: BackendHost = {
    compile: (source, signal) => sandbox.compile(source, signal),
    invoke: (...args) => current.invoke(...args),
    close: () => current.close?.() ?? Promise.resolve(),
  };
  const server = await startServer({ backendHost: host }, (query) => query(NOTES_TABLE).then(() => undefined));
  try {
    const owner = await server.token("owner@example.test");
    const first = await publishNotes(server, owner, { requestId: "notes-first", visibility: "unlisted", linkRole: "viewer" });
    const second = await publishNotes(server, owner, { requestId: "notes-second" });
    const { backends } = (await (
      await server.request(`/api/files/${first.id}/backends`, { token: owner })
    ).json()) as BackendsResponse;
    assert.equal(backends.length, 1);
    const connection = new URL(server.connectionString);
    connection.searchParams.set("options", `-c search_path=${server.schema},public`);
    current = withCapabilityAuthority(
      sandbox,
      configureResources(
        {
          resources: { "demo-db": DEMO_DB },
          grants: [first.id, second.id].map((documentId) => ({
            documentId,
            backendVersion: backends[0]!.version,
            resource: "demo-db",
            namedOperations: ["listNotes", "addNote"],
          })),
        },
        { env: { PAGEGI_DEMO_DATABASE_URL: connection.href } },
      ),
    );

    const call = async (page: string, token: string, query: string, variables?: Record<string, unknown>) =>
      (await (
        await server.request(`/api/files/${page}/graphql`, { token, body: { query, variables } })
      ).json()) as RemoteResponse;
    const notes = (response: RemoteResponse) => (response.data as { notes: Record<string, any> | null } | null)?.notes;
    const texts = async (page: string, token: string) =>
      (notes(await call(page, token, "{ notes { list { id text } } }"))!.list as { text: string }[]).map((n) => n.text);
    const add = (page: string, token: string, text: string) =>
      call(page, token, "mutation Add($text: String!) { notes { add(text: $text) { id text } } }", { text });
    const rows = async () =>
      (await server.query("SELECT tenant,text FROM notes ORDER BY created_at,id")).rows as { tenant: string; text: string }[];

    // The owner is signed in, so the backend reaches the database for them.
    assert.deepEqual(notes(await call(first.id, owner, "{ notes { viewer } }")), { viewer: "owner@example.test" });
    assert.deepEqual(await texts(first.id, owner), []);
    const added = await add(first.id, owner, "Buy milk");
    assert.deepEqual(added.extensions?.outcomes, { "notes.add": "committed" });
    assert.equal(notes(added)!.add.text, "Buy milk");
    assert.match(notes(added)!.add.id, /^[0-9a-f-]{36}$/, "the lambda chose the note's ID");
    assert.equal(notes(await add(first.id, owner, "  Call Ann  "))!.add.text, "Call Ann", "text is trimmed before it is stored");
    assert.deepEqual(await texts(first.id, owner), ["Buy milk", "Call Ann"]);

    // Another page is another tenant: the platform binds the page ID, so it never sees the first page's rows.
    assert.deepEqual(await texts(second.id, owner), []);
    assert.deepEqual((await add(second.id, owner, "Other page")).extensions?.outcomes, { "notes.add": "committed" });
    assert.deepEqual(await texts(second.id, owner), ["Other page"]);
    assert.deepEqual(await texts(first.id, owner), ["Buy milk", "Call Ann"]);
    assert.deepEqual(await rows(), [
      { tenant: first.id, text: "Buy milk" },
      { tenant: first.id, text: "Call Ann" },
      { tenant: second.id, text: "Other page" },
    ]);

    // A viewer who isn't signed in, calling with the link, is refused before the resolver runs.
    const link = ((await (await server.request(`/api/library/${first.id}/host`)).json()) as {
      state: { remote: { share: string } };
    }).state.remote.share;
    assert.deepEqual(notes(await call(first.id, link, "{ notes { viewer } }")), { viewer: null });
    const anonymousList = await call(first.id, link, "{ notes { list { id text } } }");
    assert.deepEqual(notes(anonymousList), { list: null });
    assert.deepEqual(anonymousList.errors?.map((e) => e.message), ["Sign in required"]);
    const anonymousAdd = await add(first.id, link, "Sneaky");
    assert.deepEqual(anonymousAdd.extensions?.outcomes, { "notes.add": "rejected" });
    assert.deepEqual(anonymousAdd.errors?.map((e) => e.message), ["Sign in required"]);

    // The resolver refuses an empty or over-long note before the database sees it.
    for (const text of ["   ", "x".repeat(501)]) {
      const refused = await add(first.id, owner, text);
      assert.notEqual(refused.extensions?.outcomes?.["notes.add"], "committed", JSON.stringify(text.length));
      assert.deepEqual(refused.errors?.map((e) => e.extensions?.code), ["backend_rejected"]);
    }
    assert.equal(notes(await add(first.id, owner, "y".repeat(500)))!.add.text.length, 500);
    assert.deepEqual(await texts(first.id, owner), ["Buy milk", "Call Ann", "y".repeat(500)]);
    assert.equal((await rows()).length, 4);
  } finally {
    await server.close();
  }
});
