/**
 * `caps.store` in the real isolate: resolvers in fresh containers read and
 * write their backend file's one document through the capability bridge, a
 * write from a stale version throws a conflict the resolver catches and
 * retries, signed-in and anonymous callers share the document, and over-large
 * documents are refused. Needs Postgres and `npm run build:backend`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBackendHost } from "../../../src/backend/container-host.ts";
import type { RemoteResponse } from "../../../src/graphql/af-namespace-contracts.ts";
import type { PublishResponse } from "../../../src/server/af-api-contracts.ts";
import { page, startServer } from "../support/server.ts";

const COUNTER = `import { gql } from '@afbin/apollo';
export const typeDefs = gql\`
  type Query { read: String }
  type Mutation { add(name: String!): String  stale(name: String!): String  huge: String  hugeUncaught: String  boom: String }
\`;
async function append(caps, name, staleFirst) {
  let stale = staleFirst;
  const conflicts = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const { value, version } = await caps.store.get();
    const names = [...(value?.names ?? []), name];
    try {
      await caps.store.set({ names }, { expected: stale ? version - 1 : version });
      return JSON.stringify({ names, conflicts });
    } catch (error) {
      if (error.code !== 'conflict') throw error;
      conflicts.push(error.version);
      stale = false;
    }
  }
  throw new Error('gave up');
}
export default {
  Query: {
    async read(_args, principal, caps) {
      const { value, version } = await caps.store.get();
      return JSON.stringify({ value, version, subject: principal.subject });
    },
  },
  Mutation: {
    add: ({ name }, _principal, caps) => append(caps, name, false),
    stale: ({ name }, _principal, caps) => append(caps, name, true),
    async huge(_args, _principal, caps) {
      const { version } = await caps.store.get();
      try {
        await caps.store.set({ text: 'x'.repeat(70000) }, { expected: version });
        return 'stored';
      } catch (error) {
        return 'refused';
      }
    },
    async hugeUncaught(_args, _principal, caps) {
      const { version } = await caps.store.get();
      await caps.store.set({ text: 'x'.repeat(70000) }, { expected: version });
      return 'stored';
    },
    boom() {
      throw new Error('boom at checkout\\nsecond line never shown');
    },
  },
};
`;

test("resolvers in the isolate share their file's store and retry a compare-and-swap conflict", async () => {
  const server = await startServer({ backendHost: createBackendHost({}) });
  try {
    const owner = await server.token("owner@example.test");
    const [id] = ((await (
      await server.request("/api/ids", { token: owner, body: { count: 1 }, headers: { "Idempotency-Key": "store-isolate" } })
    ).json()) as { ids: string[] }).ids;
    const published = (await (
      await server.request("/api/publish", {
        token: owner,
        body: {
          source: page("<p>Store</p>", `  <link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/${id}" data-af-name="counter">\n`),
          files: { [id!]: COUNTER },
          requestId: "store-isolate",
          visibility: "unlisted",
          linkRole: "viewer",
        },
      })
    ).json()) as PublishResponse;
    // An anonymous viewer calls with the link's read capability, as the hosted view does.
    const link = ((await (await server.request(`/api/library/${published.id}/host`)).json()) as {
      state: { remote: { share: string } };
    }).state.remote.share;
    const call = async (token: string, query: string) =>
      (await (
        await server.request(`/api/files/${published.id}/graphql`, { token, body: { query } })
      ).json()) as RemoteResponse;
    const field = (response: RemoteResponse, name: string) => {
      if (!response.data) throw Error(JSON.stringify(response));
      return JSON.parse(((response.data as Record<string, Record<string, string>>).counter![name])!);
    };

    assert.deepEqual(field(await call(owner, "{ counter { read } }"), "read"), {
      value: null,
      version: 0,
      subject: "owner@example.test",
    });
    const added = await call(owner, 'mutation { counter { add(name: "ann") } }');
    assert.deepEqual(added.extensions?.outcomes, { "counter.add": "committed" });
    assert.deepEqual(field(added, "add"), { names: ["ann"], conflicts: [] });
    // An anonymous viewer with the link writes to the same document, from a stale version first.
    const stale = await call(link, 'mutation { counter { stale(name: "guest") } }');
    assert.deepEqual(field(stale, "stale"), { names: ["ann", "guest"], conflicts: [1] }, "the conflict was caught and retried");
    assert.deepEqual(field(await call(link, "{ counter { read } }"), "read"), {
      value: { names: ["ann", "guest"] },
      version: 2,
      subject: null,
    });
    assert.deepEqual(
      (await call(owner, "mutation { counter { huge } }")).data,
      { counter: { huge: "refused" } },
      "documents over 60 KB are refused",
    );
    assert.equal(field(await call(owner, "{ counter { read } }"), "read").version, 2);

    // Uncaught, the size limit settles the field rejected under its own code, and a thrown
    // error settles unknown; the owner alone reads the message, the link's viewer only the code.
    const failed = await call(owner, "mutation { counter { hugeUncaught boom } }");
    assert.deepEqual(failed.extensions?.outcomes, { "counter.hugeUncaught": "rejected", "counter.boom": "unknown" });
    assert.deepEqual(
      failed.errors?.map((error) => error.extensions),
      [
        { code: "store_limit", detail: "The store document is limited to 60 KB of JSON; nothing was saved" },
        { code: "backend_rejected", detail: "boom at checkout" },
      ],
    );
    const theirs = await call(link, "mutation { counter { hugeUncaught boom } }");
    assert.deepEqual(theirs.errors?.map((error) => error.extensions), [{ code: "store_limit" }, { code: "backend_rejected" }]);
    assert.equal(field(await call(owner, "{ counter { read } }"), "read").version, 2, "nothing was saved");
  } finally {
    await server.close();
  }
});
