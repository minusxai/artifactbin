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
      registration("FLD123", "/imported/old", "Readable folder"),
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
    assert.equal(await service.read("FLD123"), null);
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
    assert.equal((await service.read("FLD123", "owner-token"))?.title, "Moved");
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
        "ROT123",
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
      (await service.read("ROT123"))?.rows.map((r) => r.id),
      ["PUB123"],
    );
    assert.deepEqual(
      (await service.read("ROT123", "reader-token"))?.rows.map((r) => r.id),
      ["PUB123"],
    );
    await env.pool.query(
      "UPDATE files SET access=$1::jsonb WHERE id='PRV123'",
      [JSON.stringify(policy("private", { reader: "viewer" }))],
    );
    assert.deepEqual(
      new Set(
        (await service.read("ROT123", "reader-token"))?.rows.map((r) => r.id),
      ),
      new Set(["PUB123", "PRV123"]),
    );
    await env.pool.query("UPDATE retained_folders SET access=$1::jsonb", [
      JSON.stringify(policy("unlisted")),
    ]);
    assert.deepEqual(
      (await service.read("ROT123"))?.rows.map((row) => row.id),
      ["PUB123"],
    );
    await env.pool.query("UPDATE retained_folders SET access=$1::jsonb", [
      JSON.stringify(policy("private", { reader: "viewer" })),
    ]);
    assert.equal(await service.read("ROT123"), null);
    assert.ok(await service.read("ROT123", "reader-token"));
    await env.pool.query("UPDATE retained_folders SET access=$1::jsonb", [
      JSON.stringify(policy("private")),
    ]);
    assert.equal(await service.read("ROT123", "reader-token"), null);
    assert.equal(await service.read("ROT123", "expired-token"), null);
    assert.equal(await service.read("ROT123", "scoped-token"), null);
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
      registration("LIV123", "/imported/old", "New title"),
      {
        ...registration("DEL123", "/unused", "Deleted"),
        descriptor: {
          ...registration("DEL123", "/unused", "Deleted").descriptor,
          owner: "owner",
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
    await env.pool.query(
      "CREATE FUNCTION reject_retained() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rejection' USING ERRCODE='23514'; END $$; CREATE TRIGGER reject_retained BEFORE INSERT ON retained_folders FOR EACH ROW EXECUTE FUNCTION reject_retained()",
    );
    await assert.rejects(
      createRetainedFolderExecutor(store.sql)(plan, records),
      { code: "23514" },
    );
    assert.equal(
      (
        await env.pool.query(
          "SELECT count(*) FROM file_ids WHERE kind='folder'",
        )
      ).rows[0].count,
      "0",
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
      "PAR123",
      "/old",
      "Hidden parent",
      policy("private"),
    );
    parent.descriptor.owner = "group:fixture";
    const child = registration(
      "CHD123",
      "/old/child",
      "Public child",
      policy("public"),
    );
    child.descriptor.owner = "group:fixture";
    child.descriptor.ancestorIds = ["PAR123"];
    const plan = planFolderTitles([parent.descriptor, child.descriptor], {
      "group:fixture": await store.paths.paths("group:fixture"),
    });
    assert.equal(plan.kind, "ready");
    if (plan.kind !== "ready") return;
    await createRetainedFolderExecutor(store.sql)(plan, [parent, child]);
    const service = createRetainedFolderService(store.sql);
    assert.equal(await service.read("PAR123"), null);
    assert.deepEqual((await service.read("CHD123"))?.trail, []);
    assert.equal(
      (await service.read("CHD123", "reader-token"))?.trail[0]?.id,
      "PAR123",
    );
    assert.ok(await service.read("PAR123", "reader-token"));
    await env.pool.query(
      "DELETE FROM group_memberships WHERE owner='group:fixture'",
    );
    assert.equal(await service.read("PAR123", "reader-token"), null);
    assert.deepEqual((await service.read("CHD123", "reader-token"))?.trail, []);
    await env.pool.query(
      "UPDATE retained_folders SET access=$1::jsonb WHERE legacy_id='PAR123'",
      [JSON.stringify(policy("unlisted"))],
    );
    assert.ok(await service.read("PAR123"));
    assert.equal((await service.read("CHD123"))?.trail[0]?.id, "PAR123");
    await env.pool.query(
      "UPDATE retained_folders SET access=$1::jsonb WHERE legacy_id='PAR123'",
      [JSON.stringify(policy("private"))],
    );
    assert.deepEqual((await service.read("CHD123"))?.trail, []);
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
    const parent = registration("PAR123", "/old", "Parent"),
      child = registration("CHD123", "/old/child", "Child");
    child.descriptor.ancestorIds = ["PAR123"];
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
          "SELECT state FROM retained_folders WHERE legacy_id='CHD123'",
        )
      ).rows[0].state,
      "deleted",
    );
    assert.equal(
      await createRetainedFolderService(store.sql).read("CHD123"),
      null,
    );
  } finally {
    await store.close();
    await env.cleanup();
  }
});

test("folder IDs reserve global registry occupancy, reject collisions atomically and make allocation retry", async () => {
  const env = await testDatabase(),
    store = database(env);
  try {
    await store.health();
    await insertPages(env.pool, { accounts: { owner: {} } });
    await env.pool.query(
      "INSERT INTO folders(owner,path) VALUES('owner','/old'),('owner','/second')",
    );
    const records = [
      registration("FLD123", "/old", "Folder"),
      registration("ZZZ999", "/second", "Other"),
    ];
    const plan = planFolderTitles(
      records.map((row) => row.descriptor),
      { owner: await store.paths.paths("owner") },
    );
    assert.equal(plan.kind, "ready");
    if (plan.kind !== "ready") return;
    const apply = createRetainedFolderExecutor(store.sql);
    await env.pool.query(
      "INSERT INTO file_ids(id,owner,created_at) VALUES('ZZZ999','owner',0)",
    );
    assert.equal(await apply(plan, records), "stale");
    assert.equal(
      (await env.pool.query("SELECT count(*) FROM file_ids WHERE id='FLD123'"))
        .rows[0].count,
      "0",
    );
    await env.pool.query(
      "DELETE FROM file_ids WHERE id='ZZZ999'; INSERT INTO retired_file_ids VALUES('FLD123',0)",
    );
    assert.equal(await apply(plan, records), "stale");
    assert.equal(
      (await env.pool.query("SELECT count(*) FROM retained_folders")).rows[0]
        .count,
      "0",
    );
    await env.pool.query("DELETE FROM retired_file_ids WHERE id='FLD123'");
    assert.equal(await apply(plan, records), "applied");
    const registered = (
      await env.pool.query(
        "SELECT id,owner,kind,published,created_at FROM file_ids WHERE id='FLD123'",
      )
    ).rows[0];
    assert.deepEqual(registered, {
      id: "FLD123",
      owner: "owner",
      kind: "folder",
      published: true,
      created_at: "0",
    });
    const receipt = (
      await env.pool.query("SELECT receipt FROM retained_folder_applications")
    ).rows[0].receipt;
    assert.deepEqual(receipt.registry, [
      {
        id: "FLD123",
        owner: "owner",
        kind: "folder",
        published: true,
        createdAt: 0,
      },
      {
        id: "ZZZ999",
        owner: "owner",
        kind: "folder",
        published: true,
        createdAt: 0,
      },
    ]);
    const { createIdReservationStore, claimReservedId } = await import(
      "../src/server/af-ids.ts"
    );
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let attempts = 0;
    const ids = createIdReservationStore(store.sql, {
      randomBytes: () =>
        Uint8Array.from(attempts++ === 0 ? "FLD123" : "NEW123", (char) =>
          alphabet.indexOf(char),
        ),
    });
    assert.deepEqual((await ids.reserve("owner", "retry", 1)).ids, ["NEW123"]);
    assert.equal(await ids.available("owner", "FLD123"), false);
    for (const kind of ["page", "backend"] as const)
      assert.equal(
        await store.sql.transaction((client) =>
          claimReservedId(client, "owner", "FLD123", kind),
        ),
        false,
      );
    assert.ok(await createRetainedFolderService(store.sql).read("FLD123"));
  } finally {
    await store.close();
    await env.cleanup();
  }
});

test("anonymous private-folder reads do not contend on the owner's path lock", async () => {
  const env = await testDatabase(),
    store = database(env);
  let blocker;
  try {
    await store.health();
    await insertPages(env.pool, { accounts: { owner: {} } });
    await env.pool.query(
      "INSERT INTO folders(owner,path) VALUES('owner','/old')",
    );
    const records = [
      registration("FLD123", "/old", "Private", policy("private")),
    ];
    const plan = planFolderTitles(
      records.map((row) => row.descriptor),
      { owner: await store.paths.paths("owner") },
    );
    assert.equal(plan.kind, "ready");
    if (plan.kind !== "ready") return;
    await createRetainedFolderExecutor(store.sql)(plan, records);
    blocker = await env.pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':paths:owner',0))",
    );
    const { createSqlDatabase } = await import("../src/persistence/sql.ts");
    const bounded = createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 1000,
      lockTimeoutMs: 50,
    });
    assert.equal(
      await createRetainedFolderService(bounded).read("FLD123"),
      null,
    );
  } finally {
    if (blocker) {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    await store.close();
    await env.cleanup();
  }
});

test("source title survives initial collision suffixes; subsequent explicit rename keeps its literal segment", async () => {
  const env = await testDatabase(),
    store = database(env);
  try {
    await store.health();
    await insertPages(env.pool, { accounts: { owner: {} } });
    await env.pool.query(
      "INSERT INTO folders(owner,path) VALUES('owner','/one'),('owner','/two')",
    );
    const original = "  Source / title  ";
    const records = [
      registration("AAA111", "/one", original),
      registration("BBB222", "/two", original),
    ];
    const plan = planFolderTitles(
      records.map((row) => row.descriptor),
      { owner: await store.paths.paths("owner") },
    );
    assert.equal(plan.kind, "ready");
    if (plan.kind !== "ready") return;
    await createRetainedFolderExecutor(store.sql)(plan, records);
    const service = createRetainedFolderService(store.sql);
    assert.equal((await service.read("AAA111"))?.title, original);
    const source = plan.locations.find((row) => row.legacyId === "AAA111")!;
    assert.equal(source.state, "live");
    if (source.state !== "live") return;
    assert.notEqual(source.path, "/" + original);
    await store.paths.changePath("owner", {
      kind: "move",
      from: source.path,
      path: "/Explicit title-deadbeef",
    });
    assert.equal(
      (await service.read("AAA111"))?.title,
      "Explicit title-deadbeef",
    );
    assert.equal((await service.read("BBB222"))?.title, original);
  } finally {
    await store.close();
    await env.cleanup();
  }
});

test("folder listings fail bounded rather than disclose or silently truncate over 500 page candidates", async () => {
  const env = await testDatabase(),
    store = database(env);
  try {
    await store.health();
    await insertPages(env.pool, { accounts: { owner: {} } });
    await env.pool.query(
      "INSERT INTO folders(owner,path) VALUES('owner','/old')",
    );
    const records = [registration("FLD123", "/old", "Folder")];
    const plan = planFolderTitles(
      records.map((row) => row.descriptor),
      { owner: await store.paths.paths("owner") },
    );
    assert.equal(plan.kind, "ready");
    if (plan.kind !== "ready") return;
    await createRetainedFolderExecutor(store.sql)(plan, records);
    await env.pool.query(
      "INSERT INTO file_ids(id,owner,kind,published,created_at) SELECT lpad(n::text,6,'0'),'owner','page',true,0 FROM generate_series(1,501)n; INSERT INTO files(id,owner,share_hash,generation,head,path,access) SELECT id,owner,'fixture',1,'1','/Folder/'||id||'.html','{\"visibility\":\"public\",\"linkRole\":\"viewer\",\"shares\":{},\"version\":1}'::jsonb FROM file_ids WHERE kind='page'; INSERT INTO sources(file_id,revision,content) SELECT id,'1','<title>Bounded</title>' FROM file_ids WHERE kind='page'",
    );
    await assert.rejects(
      createRetainedFolderService(store.sql).read("FLD123"),
      { status: 503 },
    );
  } finally {
    await store.close();
    await env.cleanup();
  }
});

test("concurrent mint wins cleanly without a registry-to-path lock inversion", async () => {
  const env = await testDatabase(),
    store = database(env);
  let mint;
  let pending: Promise<unknown> | undefined;
  try {
    await store.health();
    await insertPages(env.pool, { accounts: { owner: {} } });
    await env.pool.query(
      "INSERT INTO folders(owner,path) VALUES('owner','/old')",
    );
    const records = [registration("FLD123", "/old", "Folder")];
    const plan = planFolderTitles(
      records.map((row) => row.descriptor),
      { owner: await store.paths.paths("owner") },
    );
    assert.equal(plan.kind, "ready");
    if (plan.kind !== "ready") return;
    mint = await env.pool.connect();
    await mint.query("BEGIN; SET LOCAL lock_timeout='100ms'");
    await mint.query(
      "INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES('FLD123','owner','page',true,0)",
    );
    let started!: () => void;
    const inserting = new Promise<void>((resolve) => (started = resolve));
    const observed: import("../src/persistence/sql.ts").SqlDatabase = {
      transaction: (work) =>
        store.sql.transaction((client) =>
          work({
            query: (text, values) => {
              if (text.startsWith("INSERT INTO file_ids")) started();
              return client.query(text, values);
            },
            release: () => {},
          }),
        ),
    };
    pending = createRetainedFolderExecutor(observed)(plan, records);
    await inserting;
    await mint.query(
      "SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':paths:owner',0))",
    );
    await mint.query("COMMIT");
    mint.release();
    mint = undefined;
    assert.equal(await pending, "stale");
    assert.equal(
      (await env.pool.query("SELECT kind FROM file_ids WHERE id='FLD123'"))
        .rows[0].kind,
      "page",
    );
    assert.equal(
      (await env.pool.query("SELECT count(*) FROM retained_folders")).rows[0]
        .count,
      "0",
    );
  } finally {
    if (mint) {
      await mint.query("ROLLBACK");
      mint.release();
    }
    await pending?.catch(() => {});
    await store.close();
    await env.cleanup();
  }
});
