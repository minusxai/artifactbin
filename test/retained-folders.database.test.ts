import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./postgres.js";
import { database } from "../src/database.js";
import { createRetainedFolderExecutor } from "../src/migration/folder-title-apply.ts";
import { createRetainedFolderService } from "../src/retained-folders/service.ts";
import { planFolderTitles } from "../src/migration/folder-title-plan.ts";
import { insertPages } from "./fixtures/pages.js";
import { hash } from "../src/server/text.ts";
import type {
  RetainedFolderRegistration,
  FolderTitlePlan,
} from "../src/migration/folder-title-contracts.ts";
const policy = (
  visibility: "public" | "private" | "unlisted",
  shares = {},
) => ({ visibility, linkRole: "viewer" as const, shares, version: 1 });
const registration = (
  id: string,
  path: string,
  title: string,
  access = policy("public"),
): RetainedFolderRegistration => ({
  descriptor: {
    namespace: "fixture",
    legacyId: id,
    owner: "owner",
    title,
    expectedPath: path,
    ancestorIds: [],
    sourceRevision: "1",
    deleted: false,
  },
  access,
});

test("postimport plans commit atomically, replay idempotently and follow real path/trash operations", async () => {
  const env = await testDatabase(),
    store = database(env);
  try {
    await store.health();
    await insertPages(env.pool, {
      accounts: { owner: {} },
      tokens: {
        [hash("owner-token")]: { actor: "owner", expires: Date.now() + 60000 },
      },
      files: {
        ABC123: {
          owner: "owner",
          head: "1",
          path: "/imported/old/page.html",
          sources: { "1": "<title>Page</title>" },
        },
      },
    });
    const service = {
      ...createRetainedFolderService(store.sql),
      apply: createRetainedFolderExecutor(store.sql),
    };
    const records = [
      registration("old-folder", "/imported/old", "Readable folder"),
    ];
    const expected = { owner: await store.paths.paths("owner") };
    const plan = planFolderTitles(
      records.map((r) => r.descriptor),
      expected,
    );
    assert.equal(plan.kind, "ready");
    if (plan.kind !== "ready") return;
    await env.pool.query(
      "INSERT INTO folders(owner,path) VALUES('owner','/new-user-folder')",
    );
    assert.equal(await service.apply(plan, records), "stale");
    assert.equal(
      (await env.pool.query("SELECT count(*) FROM retained_folders")).rows[0]
        .count,
      "0",
    );
    await env.pool.query("DELETE FROM folders WHERE path='/new-user-folder'");
    assert.deepEqual(
      (
        await Promise.all([
          service.apply(plan, records),
          service.apply(plan, records),
        ])
      ).sort(),
      ["already-applied", "applied"],
    );
    assert.equal(await service.apply(plan, records), "already-applied");
    assert.equal(
      (await env.pool.query("SELECT path FROM files WHERE id='ABC123'")).rows[0]
        .path,
      "/imported/Readable folder/page.html",
    );
    await store.paths.changePath("owner", {
      kind: "move",
      from: "/imported/Readable folder",
      path: "/Moved",
    });
    assert.equal(
      (await env.pool.query("SELECT path FROM retained_folders")).rows[0].path,
      "/Moved",
    );
    const { createService } = await import("../src/server.js");
    const http = createService(env);
    await new Promise<void>((resolve) =>
      http.server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const origin =
        "http://127.0.0.1:" + (http.server.address() as { port: number }).port;
      for (const [from, path] of [
        ["/Moved", "/Moved again"],
        ["/Moved again", "/Moved"],
      ]) {
        const moved = await fetch(origin + "/api/paths", {
          method: "POST",
          headers: {
            Authorization: "Bearer owner-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ kind: "move", from, path }),
        });
        assert.equal(moved.status, 200, await moved.text());
        assert.equal(
          (await env.pool.query("SELECT path FROM retained_folders")).rows[0]
            .path,
          path,
        );
      }
    } finally {
      await http.close();
      await new Promise<void>((resolve) => http.server.close(() => resolve()));
    }
    const { createTrashService } = await import("../src/trash/service.ts");
    const { accountActor } = await import("../src/server/identity-policy.ts");
    const trash = createTrashService(store.sql, (s) =>
      accountActor(s, Date.now()),
    );
    const receipt = await trash.handle(
      "owner-token",
      new URL("http://local.invalid/api/trash/folders"),
      "POST",
      { path: "/Moved" },
    );
    assert.ok(receipt && "id" in receipt);
    assert.equal(await service.read("old-folder"), null);
    await store.paths.changePath("owner", { kind: "folder", path: "/Moved" });
    await assert.rejects(
      trash.handle(
        "owner-token",
        new URL("http://local.invalid/api/trash/" + receipt!.id + "/restore"),
        "POST",
      ),
      { status: 409 },
    );
    assert.equal(
      (await env.pool.query("SELECT state FROM retained_folders")).rows[0]
        .state,
      "trash",
    );
    await store.paths.changePath("owner", {
      kind: "remove-folder",
      path: "/Moved",
    });
    const restore = await trash.handle(
      "owner-token",
      new URL("http://local.invalid/api/trash/" + receipt!.id + "/restore"),
      "POST",
    );
    assert.ok(restore);
    assert.equal(
      (await env.pool.query("SELECT state,path FROM retained_folders")).rows[0]
        .state,
      "live",
    );
    assert.equal(
      (await service.read("old-folder", "owner-token"))?.title,
      "Moved",
    );
  } finally {
    await store.close();
    await env.cleanup();
  }
});

test("retained folder reads enforce fresh folder ACL, independent child ACL and account scope", async () => {
  const env = await testDatabase(),
    store = database(env);
  try {
    await store.health();
    await insertPages(env.pool, {
      accounts: { owner: {}, reader: {} },
      tokens: {
        [hash("reader-token")]: {
          actor: "reader",
          expires: Date.now() + 60000,
        },
        [hash("expired-token")]: { actor: "reader", expires: 0 },
        [hash("scoped-token")]: {
          actor: "reader",
          fileId: "PUB123",
          expires: Date.now() + 60000,
        },
      },
      files: {
        PUB123: {
          owner: "owner",
          head: "1",
          path: "/imported/root/public.html",
          access: policy("public"),
          sources: { "1": "<title>Public child</title>" },
        },
        PRV123: {
          owner: "owner",
          head: "1",
          path: "/imported/root/private.html",
          access: policy("private"),
          sources: { "1": "<title>Private child</title>" },
        },
        UNL123: {
          owner: "owner",
          head: "1",
          path: "/imported/root/unlisted.html",
          access: policy("unlisted"),
          sources: { "1": "<title>Unlisted child</title>" },
        },
      },
    });
    const records = [
      registration(
        "root",
        "/imported/root",
        "Public folder",
        policy("public", { reader: "editor" }),
      ),
    ];
    const plan = planFolderTitles(
      records.map((r) => r.descriptor),
      { owner: await store.paths.paths("owner") },
    ) as FolderTitlePlan;
    const service = {
      ...createRetainedFolderService(store.sql),
      apply: createRetainedFolderExecutor(store.sql),
    };
    assert.equal(await service.apply(plan, records), "applied");
    assert.deepEqual(
      (await service.read("root"))?.rows.map((r) => r.id),
      ["PUB123"],
    );
    assert.deepEqual(
      (await service.read("root", "reader-token"))?.rows.map((r) => r.id),
      ["PUB123"],
    );
    await env.pool.query(
      "UPDATE files SET access=$1::jsonb WHERE id='PRV123'",
      [JSON.stringify(policy("private", { reader: "viewer" }))],
    );
    assert.deepEqual(
      new Set(
        (await service.read("root", "reader-token"))?.rows.map((r) => r.id),
      ),
      new Set(["PUB123", "PRV123"]),
    );
    await env.pool.query("UPDATE retained_folders SET access=$1::jsonb", [
      JSON.stringify(policy("unlisted")),
    ]);
    assert.deepEqual(
      (await service.read("root"))?.rows.map((row) => row.id),
      ["PUB123"],
    );
    await env.pool.query("UPDATE retained_folders SET access=$1::jsonb", [
      JSON.stringify(policy("private", { reader: "viewer" })),
    ]);
    assert.equal(await service.read("root"), null);
    assert.ok(await service.read("root", "reader-token"));
    await env.pool.query("UPDATE retained_folders SET access=$1::jsonb", [
      JSON.stringify(policy("private")),
    ]);
    assert.equal(await service.read("root", "reader-token"), null);
    await assert.rejects(service.read("root", "expired-token"), {
      status: 401,
    });
    await assert.rejects(service.read("root", "scoped-token"), { status: 401 });
  } finally {
    await store.close();
    await env.cleanup();
  }
});

test("failed registration rolls back renamed paths, mappings and application receipt", async () => {
  const env = await testDatabase(),
    store = database(env);
  try {
    await store.health();
    await insertPages(env.pool, {
      accounts: { owner: {} },
      files: {
        ABC123: {
          owner: "owner",
          head: "1",
          path: "/imported/old/page.html",
          sources: { "1": "<title>Unchanged</title>" },
        },
      },
    });
    const records = [
      registration("live", "/imported/old", "New title"),
      {
        ...registration("deleted", "/unused", "Deleted"),
        descriptor: {
          ...registration("deleted", "/unused", "Deleted").descriptor,
          owner: "absent",
          deleted: true,
          expectedPath: null,
        },
      },
    ];
    const expected = { owner: await store.paths.paths("owner") };
    const plan = planFolderTitles(
      records.map((row) => row.descriptor),
      expected,
    );
    assert.equal(plan.kind, "ready");
    if (plan.kind !== "ready") return;
    await assert.rejects(
      createRetainedFolderExecutor(store.sql)(plan, records),
      { code: "23503" },
    );
    assert.deepEqual(await store.paths.paths("owner"), expected.owner);
    assert.equal(
      (await env.pool.query("SELECT count(*) FROM retained_folders")).rows[0]
        .count,
      "0",
    );
    assert.equal(
      (
        await env.pool.query(
          "SELECT count(*) FROM retained_folder_applications",
        )
      ).rows[0].count,
      "0",
    );
  } finally {
    await store.close();
    await env.cleanup();
  }
});

test("fresh group membership gates private retained folders and private ancestor names", async () => {
  const env = await testDatabase(),
    store = database(env);
  try {
    await store.health();
    await insertPages(env.pool, {
      accounts: { reader: {} },
      tokens: {
        [hash("reader-token")]: {
          actor: "reader",
          expires: Date.now() + 60000,
        },
      },
    });
    await env.pool.query(
      "INSERT INTO accounts(actor,principal_kind) VALUES('group:fixture','group'); INSERT INTO groups(owner) VALUES('group:fixture'); INSERT INTO group_memberships(owner,actor,role) VALUES('group:fixture','reader','viewer'); INSERT INTO folders(owner,path) VALUES('group:fixture','/old'),('group:fixture','/old/child')",
    );
    const parent = registration(
      "parent",
      "/old",
      "Hidden parent",
      policy("private"),
    );
    parent.descriptor.owner = "group:fixture";
    const child = registration(
      "child",
      "/old/child",
      "Public child",
      policy("public"),
    );
    child.descriptor.owner = "group:fixture";
    child.descriptor.ancestorIds = ["parent"];
    const plan = planFolderTitles([parent.descriptor, child.descriptor], {
      "group:fixture": await store.paths.paths("group:fixture"),
    });
    assert.equal(plan.kind, "ready");
    if (plan.kind !== "ready") return;
    await createRetainedFolderExecutor(store.sql)(plan, [parent, child]);
    const service = createRetainedFolderService(store.sql);
    assert.equal(await service.read("parent"), null);
    assert.deepEqual((await service.read("child"))?.trail, []);
    assert.equal(
      (await service.read("child", "reader-token"))?.trail[0]?.id,
      "parent",
    );
    assert.ok(await service.read("parent", "reader-token"));
    await env.pool.query(
      "DELETE FROM group_memberships WHERE owner='group:fixture'",
    );
    assert.equal(await service.read("parent", "reader-token"), null);
    assert.deepEqual((await service.read("child", "reader-token"))?.trail, []);
    await env.pool.query(
      "UPDATE retained_folders SET access=$1::jsonb WHERE legacy_id='parent'",
      [JSON.stringify(policy("unlisted"))],
    );
    assert.ok(await service.read("parent"));
    assert.equal((await service.read("child"))?.trail[0]?.id, "parent");
    await env.pool.query(
      "UPDATE retained_folders SET access=$1::jsonb WHERE legacy_id='parent'",
      [JSON.stringify(policy("private"))],
    );
    assert.deepEqual((await service.read("child"))?.trail, []);
  } finally {
    await store.close();
    await env.cleanup();
  }
});

test("nested batch moves and empty-folder removal preserve or tombstone stable locations", async () => {
  const env = await testDatabase(),
    store = database(env);
  try {
    await store.health();
    await insertPages(env.pool, { accounts: { owner: {} } });
    await env.pool.query(
      "INSERT INTO folders(owner,path) VALUES('owner','/old'),('owner','/old/child'),('owner','/Destination')",
    );
    const parent = registration("parent", "/old", "Parent"),
      child = registration("child", "/old/child", "Child");
    child.descriptor.ancestorIds = ["parent"];
    const plan = planFolderTitles([parent.descriptor, child.descriptor], {
      owner: await store.paths.paths("owner"),
    });
    assert.equal(plan.kind, "ready");
    if (plan.kind !== "ready") return;
    await createRetainedFolderExecutor(store.sql)(plan, [parent, child]);
    await store.paths.changePath("owner", {
      kind: "move-many",
      paths: ["/Parent", "/Parent/Child"],
      destination: "/Destination",
    });
    assert.deepEqual(
      (
        await env.pool.query("SELECT path FROM retained_folders ORDER BY path")
      ).rows.map((row: { path: string }) => row.path),
      ["/Destination/Parent", "/Destination/Parent/Child"],
    );
    await store.paths.changePath("owner", {
      kind: "remove-folder",
      path: "/Destination/Parent/Child",
    });
    assert.equal(
      (
        await env.pool.query(
          "SELECT state FROM retained_folders WHERE legacy_id='child'",
        )
      ).rows[0].state,
      "deleted",
    );
    assert.equal(
      await createRetainedFolderService(store.sql).read("child"),
      null,
    );
  } finally {
    await store.close();
    await env.cleanup();
  }
});
