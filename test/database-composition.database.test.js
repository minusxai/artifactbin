import test from "node:test";
import assert from "node:assert/strict";
import { database } from "../src/database.js";
import { testDatabase } from "./postgres.js";
import { insertPages } from "./fixtures/pages.js";
test("database exposes semantic repositories and lifecycle without a generic projected transaction", async () => {
  const env = await testDatabase(),
    store = database(env);
  try {
    assert.equal("transaction" in store, false);
    for (const name of [
      "identity",
      "collaboration",
      "comments",
      "catalog",
      "paths",
    ])
      assert.equal(typeof store[name], "object", name);
    await store.health();
    assert.deepEqual(await store.catalog.library("absent"), []);
    assert.equal(await store.catalog.sharedLink("absent"), null);
  } finally {
    await store.close();
    await env.cleanup();
  }
});
test("metadata queries preserve owner, invited and public listings, profiles, locators and atomic path changes", async () => {
  const env = await testDatabase(),
    store = database(env);
  try {
    const file = (owner, path, title, access) => ({
      owner,
      path,
      shareHash: "hash",
      generation: 1,
      head: "1",
      sequence: 0,
      sources: { 1: `<title>${title}</title><p>Body</p>` },
      comments: {},
      snapshots: {},
      access,
    });
    await store.health();
    await insertPages(env.pool, {
        accounts: {
          alice: { name: "Alice" },
          bob: { name: "Bob", image: "avatar" },
        },
        files: {
          Alpha1: file("alice", "/alpha.html", "Alpha", {
            visibility: "public",
            linkRole: "viewer",
            shares: { bob: "commenter" },
            version: 1,
          }),
          Beta02: file("bob", "/beta.html", "Beta", {
            visibility: "private",
            linkRole: "viewer",
            shares: { alice: "viewer" },
            version: 1,
          }),
        },
      });
    const aUrl = await store.catalog.sharedLink("Alpha1");
    assert.deepEqual(await store.catalog.library("alice"), [
      {
        fileId: "Alpha1",
        path: "/alpha.html",
        url: aUrl,
        sourceRevision: "1",
        title: "Alpha",
        commentCount: 0,
      },
    ]);
    assert.deepEqual(
      (await store.catalog.discover("bob")).map((file) => file.fileId),
      ["Alpha1"],
    );
    assert.deepEqual(
      (await store.catalog.discover("alice")).map((file) => file.fileId),
      ["Beta02"],
    );
    assert.deepEqual(
      (await store.catalog.discover(null, true)).map((file) => file.fileId),
      ["Alpha1"],
    );
    assert.deepEqual(await store.catalog.profiles("Alpha1", ["bob"]), {
      alice: { name: "Alice", image: null },
      bob: { name: "Bob", image: "avatar" },
    });
    assert.equal(aUrl, "/a/Alpha1");
    assert.equal(await store.catalog.resolvePath("alice", "alpha.html"), "Alpha1");
    assert.equal(await store.catalog.resolvePath("bob", "alpha.html"), null);
    const space = (
      await env.pool.query("SELECT space FROM accounts WHERE actor='alice'")
    ).rows[0].space;
    assert.equal(
      await store.catalog.resolveSharedPath(space, "/alpha.html"),
      "Alpha1",
    );
    await store.paths.changePath("alice", {
      kind: "move",
      from: "/alpha.html",
      path: "/renamed.html",
    });
    assert.equal(await store.catalog.filePath("alice", "Alpha1"), "/renamed.html");
    assert.equal(await store.catalog.sharedLink("Alpha1"), aUrl);
    await assert.rejects(
      store.paths.changePath("alice", {
        kind: "move",
        from: "/renamed.html",
        path: "../escape.html",
      }),
    );
    assert.equal(await store.catalog.filePath("alice", "Alpha1"), "/renamed.html");
  } finally {
    await store.close();
    await env.cleanup();
  }
});
