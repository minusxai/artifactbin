/**
 * Integration (briefs B + C + D): a page published with its linked backend
 * files, then called over the page's GraphQL endpoint. Green only after all
 * three briefs merge. Needs Postgres and the Docker backend image.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBackendHost } from "../../../src/backend/container-host.ts";
import type { BackendsResponse } from "../../../src/backend/af-backend-contracts.ts";
import type { RemoteResponse } from "../../../src/graphql/af-namespace-contracts.ts";
import type { PublishResponse, SaveResponse } from "../../../src/server/af-api-contracts.ts";
import { page, startServer, type TestServer } from "../support/server.ts";

const LEDGER = (greeting: string) => `import { gql } from '@afbin/apollo';

export const typeDefs = gql\`
  type Entry { note: String!  by: String }
  type Query { whoami: String  greeting: String! }
  type Mutation { record(note: String!): Entry! @auth(role: EDITOR) }
\`;

export default {
  Query: {
    whoami: (_args, principal) => principal.subject,
    greeting: () => ${JSON.stringify(greeting)},
  },
  Mutation: {
    record: ({ note }, principal) => ({ note, by: principal.subject }),
  },
};
`;
const NOTES = `export const typeDefs = 'type Entry { id: ID! } type Query { list: [Entry!]! }';
export default { Query: { list: () => [{ id: "1" }] } };
`;

async function reserve(server: TestServer, token: string, count: number, key: string): Promise<string[]> {
  const response = await server.request("/api/ids", { token, body: { count }, headers: { "Idempotency-Key": key } });
  return ((await response.json()) as { ids: string[] }).ids;
}
const links = (ledger: string, notes: string) =>
  `  <link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/${ledger}" data-af-name="ledger">
  <link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/${notes}" data-af-name="notes">
`;
const graphql = async (server: TestServer, id: string, token: string, query: string) =>
  (await (await server.request(`/api/files/${id}/graphql`, { token, body: { query } })).json()) as RemoteResponse;

test("publishing a page publishes its linked backends, and viewers call them under their names", async () => {
  const host = createBackendHost({});
  const server = await startServer({ backendHost: host });
  try {
    const owner = await server.token("owner@example.test");
    const [ledger, notes] = await reserve(server, owner, 2, "integration-ids-01");
    assert.ok(ledger && notes);

    // A linked, unpublished file must come with the page.
    const missing = await server.request("/api/publish", {
      token: owner,
      body: { source: page("<p>x</p>", links(ledger, notes)), files: { [ledger]: LEDGER("hi") }, requestId: "missing" },
    });
    assert.equal(missing.status, 422);
    assert.match(((await missing.json()) as { error: string }).error, new RegExp(notes));

    const response = await server.request("/api/publish", {
      token: owner,
      body: {
        source: page("<p>Ledger</p>", links(ledger, notes)),
        files: { [ledger]: LEDGER("hi"), [notes]: NOTES },
        requestId: "with-backends",
        visibility: "public",
      },
    });
    assert.equal(response.status, 201);
    const published = (await response.json()) as PublishResponse;
    assert.match(published.source, new RegExp(`href="${server.origin}/af/v1/ids/${ledger}" data-af-name="ledger"`));

    const listed = (await (await server.request(`/api/files/${published.id}/backends`, { token: owner })).json()) as BackendsResponse;
    assert.deepEqual(
      listed.backends.map(({ name, id }) => ({ name, id })),
      [
        { name: "ledger", id: ledger },
        { name: "notes", id: notes },
      ],
    );
    assert.match(listed.backends[0]!.typeDefs, /type Entry \{ note: String!  by: String \}/);

    const both = await graphql(server, published.id, owner, "{ ledger { whoami greeting } notes { list { id } } }");
    assert.deepEqual(both.data, { ledger: { whoami: "owner@example.test", greeting: "hi" }, notes: { list: [{ id: "1" }] } });

    const ownerWrite = await graphql(server, published.id, owner, 'mutation { ledger { record(note: "paid") { note by } } }');
    assert.deepEqual(ownerWrite.data, { ledger: { record: { note: "paid", by: "owner@example.test" } } });
    assert.deepEqual(ownerWrite.extensions?.outcomes, { "ledger.record": "committed" });

    // A signed-in viewer calls the page's backends at once: there is nothing to approve.
    const viewer = await server.token("viewer@example.test");
    const before = (await (await server.request(`/api/files/${published.id}/backends`, { token: viewer })).json()) as BackendsResponse;
    assert.equal(before.backends.length, 2);
    assert.deepEqual((await graphql(server, published.id, viewer, "{ ledger { whoami } }")).data, { ledger: { whoami: "viewer@example.test" } });
    const viewerWrite = await graphql(server, published.id, viewer, 'mutation { ledger { record(note: "x") { note } } }');
    assert.deepEqual(viewerWrite.extensions?.outcomes, { "ledger.record": "rejected" });

    // Saving a changed backend file makes a new version, which viewers call without any step either.
    const saved = await server.request(`/api/files/${published.id}/source`, {
      method: "PUT",
      token: owner,
      body: { source: published.source, files: { [ledger]: LEDGER("hello") } },
      headers: { "If-Match": "1" },
    });
    assert.equal(saved.status, 200);
    assert.equal(((await saved.json()) as SaveResponse).version, 2);
    const after = (await (await server.request(`/api/files/${published.id}/backends`, { token: viewer })).json()) as BackendsResponse;
    assert.notEqual(after.backends[0]!.version, before.backends[0]!.version);
    assert.equal(after.backends[1]!.version, before.backends[1]!.version);
    assert.deepEqual((await graphql(server, published.id, viewer, "{ ledger { greeting } }")).data, { ledger: { greeting: "hello" } });
    assert.deepEqual((await graphql(server, published.id, owner, "{ ledger { greeting } }")).data, { ledger: { greeting: "hello" } });
  } finally {
    await server.close();
  }
});

test("files must belong to the page and to the publisher", async () => {
  const host = createBackendHost({});
  const server = await startServer({ backendHost: host });
  try {
    const owner = await server.token("a@example.test");
    const other = await server.token("b@example.test");
    const [mine] = await reserve(server, owner, 1, "files-owner-0001");
    const [theirs] = await reserve(server, other, 1, "files-other-0001");
    const link = (id: string) => `  <link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/${id}" data-af-name="b">\n`;
    const notLinked = await server.request("/api/publish", {
      token: owner,
      body: { source: page("<p>x</p>"), files: { [mine!]: NOTES }, requestId: "not-linked" },
    });
    assert.equal(notLinked.status, 422);
    const notMine = await server.request("/api/publish", {
      token: owner,
      body: { source: page("<p>x</p>", link(theirs!)), files: { [theirs!]: NOTES }, requestId: "not-mine" },
    });
    assert.equal(notMine.status, 422);
    const broken = await server.request("/api/publish", {
      token: owner,
      body: { source: page("<p>x</p>", link(mine!)), files: { [mine!]: "export default {};" }, requestId: "broken" },
    });
    assert.equal(broken.status, 422);
    const { entries } = (await (await server.request("/api/paths", { token: owner })).json()) as { entries: unknown[] };
    assert.deepEqual(entries, [], "a failed publish saves nothing");
  } finally {
    await server.close();
  }
});
