import test from "node:test";
import assert from "node:assert/strict";
import { database } from "../src/database.js";
import { testDatabase } from "./postgres.js";
import { insertPages } from "./fixtures/pages.js";
import { createDocumentCatalog } from "../src/persistence/document-catalog.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
test("catalog scopes membership and profile fallback, and retains document identity across path moves", async () => {
  const env = await testDatabase(),
    store = database(env);
  try {
    const file = (owner, title, access) => ({
      owner,
      shareHash: "hash",
      generation: 1,
      head: "1",
      sequence: 0,
      sources: { 1: `<title>${title}</title>` },
      comments: {},
      snapshots: {},
      access,
    });
    const access = {
      visibility: "public",
      linkRole: "viewer",
      shares: { invited: "viewer" },
      version: 1,
    };
    await store.health();
    await insertPages(env.pool, {
        accounts: {
          owner: {},
          author: { name: "Author" },
          viewer: {},
          unrelated: {},
          invited: {},
        },
        files: {
          Doc001: {
            ...file("owner", "Original", access),
            path: "/original.html",
            sequence: 1,
            comments: {
              c: {
                id: "c",
                nodeId: null,
                quote: "",
                body: "Note",
                sourceRevision: "1",
                parentId: null,
                appStateId: null,
                publishedBy: "author",
                createdAt: "2026-01-01",
                revision: 1,
                resolved: false,
                fingerprint: "f",
                sequence: 1,
              },
            },
          },
          Other1: file("unrelated", "Private", {
            ...access,
            visibility: "private",
            shares: {},
          }),
        },
      });
    const catalog = createDocumentCatalog(
      createSqlDatabase({
        pool: env.pool,
        initialize: async () => {},
        statementTimeoutMs: 15000,
        lockTimeoutMs: 5000,
      }),
    );
    assert.deepEqual(
      (await catalog.library("owner")).map((row) => row.fileId),
      ["Doc001"],
    );
    assert.deepEqual(
      (await catalog.discover("invited")).map((row) => row.fileId),
      ["Doc001"],
    );
    assert.deepEqual(
      (await catalog.discover(null, true)).map((row) => row.fileId),
      ["Doc001"],
    );
    assert.deepEqual(await catalog.profiles("Doc001", ["viewer"]), {
      owner: { name: "owner", image: null },
      author: { name: "Author", image: null },
      viewer: { name: "viewer", image: null },
    });
    assert.equal(await catalog.sharedLink("absent"), null);
    const link = await catalog.sharedLink("Doc001");
    const oldPath = await catalog.filePath("owner", "Doc001");
    assert.equal(link, "/a/Doc001");
    assert.equal(await catalog.resolvePath("unrelated", oldPath), null);
    await store.paths.changePath("owner", {
      kind: "move",
      from: oldPath,
      path: "/moved.html",
    });
    assert.equal(await catalog.sharedLink("Doc001"), link);
    assert.equal(await catalog.resolvePath("owner", "/moved.html"), "Doc001");
    assert.deepEqual(
      await store.collaboration.profiles("Doc001", ["viewer"]),
      await catalog.profiles("Doc001", ["viewer"]),
    );
  } finally {
    await store.close();
    await env.cleanup();
  }
});
