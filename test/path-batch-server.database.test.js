import { test } from "node:test";
import assert from "node:assert/strict";
import { database } from "../src/database.js";
import { testDatabase } from "./postgres.js";
import { insertPages } from "./fixtures/pages.js";
test("batch paths rollback conflicts, isolate owners and serialize concurrent moves without splitting selection", async () => {
  const env = await testDatabase(),
    store = database(env);
  try {
    const s = { accounts: {}, tokens: {}, files: {}, publications: {} };
    s.accounts.owner = {};
    s.accounts.other = {};
    for (const [id, path, owner] of [
      ["Aaaaa1", "/a.html", "owner"],
      ["Bbbbb1", "/b.html", "owner"],
      ["Ccccc1", "/archive/b.html", "owner"],
      ["Other1", "/a.html", "other"],
    ])
      s.files[id] = {
        owner,
        path,
        shareHash: id,
        generation: 1,
        head: "1",
        sequence: 0,
        sources: { 1: "<p>Original</p>" },
        comments: {},
        snapshots: {},
      };
    await store.health();
    await insertPages(env.pool, s);
    await store.paths.changePath("owner", {
      kind: "folder",
      path: "/destination",
    });
    await store.paths.changePath("owner", { kind: "folder", path: "/second" });
    const before = await store.paths.paths("owner");
    await assert.rejects(
      store.paths.changePath("owner", {
        kind: "move-many",
        paths: ["/a.html", "/b.html"],
        destination: "/archive",
      }),
      { status: 409 },
    );
    assert.deepEqual(await store.paths.paths("owner"), before);
    const moves = await Promise.allSettled(
      ["/destination", "/second"].map((destination) =>
        store.paths.changePath("owner", {
          kind: "move-many",
          paths: ["/a.html", "/b.html"],
          destination,
        }),
      ),
    );
    assert.equal(moves.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(moves.find((x) => x.status === "rejected").reason.status, 404);
    const after = await store.paths.paths("owner"),
      a = after.find((x) => x.fileId === "Aaaaa1"),
      b = after.find((x) => x.fileId === "Bbbbb1");
    assert.equal(
      a.path.slice(0, a.path.lastIndexOf("/")),
      b.path.slice(0, b.path.lastIndexOf("/")),
    );
    assert.equal(
      (await store.paths.paths("other")).find((x) => x.fileId === "Other1").path,
      "/a.html",
    );
    assert.equal(
      (await env.pool.query("SELECT count(*)::int n FROM sources")).rows[0].n,
      4,
    );
  } finally {
    await store.close();
    await env.cleanup();
  }
});
