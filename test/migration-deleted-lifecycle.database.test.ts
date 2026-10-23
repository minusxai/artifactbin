// @requires migration-database
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { testDatabase } from "./postgres.js";
import { planMigration, migrationPageDigest } from "../src/migration/import.ts";
import {
  PostgresMigrationDestination,
  buildAccountMaps,
  publicationPath,
} from "../src/migration/postgres.ts";
import {
  verifyDeletedMigrationRuntime,
  verifyMigrationRuntime,
} from "../src/migration/page-verification.ts";
import { loadDocumentHeader } from "../src/persistence/document-records.ts";
import { listTrash } from "../src/trash/repository.ts";
import { createTrashService } from "../src/trash/service.ts";
import type { MigrationManifest } from "../src/migration/contracts.ts";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
test("deleted import is atomic, exact, replayable and restores through ordinary trash lifecycle", async () => {
  const db = await testDatabase(),
    client = await db.pool.connect();
  const manifest: MigrationManifest = {
    schemaVersion: 1,
    sourceNamespace: "fixture-deleted",
    exportedAt: "epoch",
    tokenOwners: [],
    tables: {
      users: [{ id: "owner", email: "owner@example.test" }],
      artifact_versions: [
        { artifact_id: "Abc123", version: 1, format: "markup", source: "old" },
      ],
    },
    artifacts: [
      {
        id: "Abc123",
        version: 2,
        format: "markup",
        source: "head",
        user_id: "owner",
        group_id: null,
        token_id: null,
        document: null,
        visibility: "private",
        link_role: "viewer",
      },
    ],
  };
  const options = {
    schema: db.schema,
    origin: "http://localhost:8787",
    isolated: true,
    editorManageRestricted: true,
  };
  try {
    const plan = await planMigration(manifest, {
      maps: buildAccountMaps(manifest),
      coreUrl: "/af/v1/core.js",
      convert: ({ source }) => ({
        classification: "functional",
        html: `<html><body><p data-af-id="text">${source}</p></body></html>`,
        identities: {},
        issues: [],
      }),
    });
    const page = plan.pages[0]!;
    page.original.deleted_at = "2020-01-02T03:04:05.000Z";
    const initial = new PostgresMigrationDestination(client, options);
    await initial.prepare({ manifest, maps: plan.maps });
    await assert.rejects(
      initial.importDeletedPage("fixture-deleted:Abc123", "digest", page),
      /preparation/,
    );
    const destination = new PostgresMigrationDestination(client, options);
    await assert.rejects(
      destination.prepareDeleted({
        sourceNamespace: manifest.sourceNamespace,
        archiveDigest: "0".repeat(64),
        maps: plan.maps,
      }),
      /archive/i,
    );
    await assert.rejects(
      destination.prepareDeleted({
        sourceNamespace: manifest.sourceNamespace,
        archiveDigest: sha(JSON.stringify(manifest)),
        maps: { ...plan.maps, users: {} },
      }),
      /map/i,
    );
    await client.query("BEGIN READ ONLY");
    await destination.prepareDeleted({
      sourceNamespace: manifest.sourceNamespace,
      archiveDigest: sha(JSON.stringify(manifest)),
      maps: plan.maps,
    });
    await client.query("COMMIT");
    assert.equal(destination.supportsExactAccess(page), false);
    assert.equal(destination.supportsExactDeletedAccess(page), true);
    await assert.rejects(
      destination.importPage("fixture-deleted:Abc123", "digest", page),
    );
    const invalid = structuredClone(page);
    invalid.original.deleted_at = "invalid";
    assert.equal(destination.supportsExactDeletedAccess(invalid), false);
    await assert.rejects(
      destination.importDeletedPage(
        "fixture-deleted:Abc123",
        "digest",
        invalid,
      ),
    );
    const live = structuredClone(page);
    live.original.deleted_at = null;
    await assert.rejects(
      destination.importDeletedPage("fixture-deleted:Abc123", "digest", live),
    );
    const key = "fixture-deleted:Abc123",
      digest = migrationPageDigest(page);
    assert.equal(
      await destination.importDeletedPage(key, digest, page),
      "created",
    );
    assert.equal(
      await destination.importDeletedPage(key, digest, page),
      "unchanged",
    );
    await assert.rejects(
      destination.importDeletedPage(key, "changed", page),
      /receipt conflicts/,
    );
    const row = (
      await client.query(
        "SELECT deleted_at,trash_path,trash_batch,head FROM files WHERE id=$1",
        [page.pageId],
      )
    ).rows[0];
    assert.deepEqual(row, {
      deleted_at: String(Date.parse(String(page.original.deleted_at))),
      trash_path: publicationPath(page),
      trash_batch: null,
      head: "2",
    });
    assert.equal((await client.query("SELECT * FROM folders")).rowCount, 0);
    assert.equal(await loadDocumentHeader(client, page.pageId), null);
    assert.deepEqual(
      (await listTrash(client, page.owner!.id)).map((r) => r.id),
      [page.pageId],
    );
    const input = () => ({
      pages: (async function* () {
        yield page;
      })(),
      maps: plan.maps,
      origin: options.origin,
    });
    assert.equal(
      (await verifyDeletedMigrationRuntime(client, db.schema, input())).sources,
      2,
    );
    await assert.rejects(
      verifyMigrationRuntime(client, db.schema, input()),
      /owner\/head\/ACL/,
    );
    const broken = structuredClone(page);
    broken.pageId = "Def456";
    broken.legacyId = "broken";
    broken.comments = [{ id: "bad", author_user_id: "missing" }];
    await assert.rejects(
      destination.importDeletedPage("fixture-deleted:broken", "broken", broken),
      /Unmapped comment author/,
    );
    assert.equal(
      (
        await client.query("SELECT * FROM file_ids WHERE id=$1", [
          broken.pageId,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await client.query("SELECT * FROM sources WHERE file_id=$1", [
          broken.pageId,
        ])
      ).rowCount,
      0,
    );
    const database = {
      transaction: async <T>(fn: (c: typeof client) => Promise<T>) => {
        await client.query("BEGIN");
        try {
          const r = await fn(client);
          await client.query("COMMIT");
          return r;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        }
      },
    };
    const trash = createTrashService(database, () => page.owner!.id);
    await client.query("INSERT INTO folders(owner,path) VALUES($1,$2)", [
      page.owner!.id,
      "/imported",
    ]);
    await client.query(
      "INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES('Xyz789',$1,'page',true,0)",
      [page.owner!.id],
    );
    await client.query(
      "INSERT INTO files(id,owner,share_hash,generation,head,path) VALUES($1,$2,$3,1,1,$4)",
      ["Xyz789", page.owner!.id, "fixture", publicationPath(page)],
    );
    await assert.rejects(
      trash.handle(
        "fixture",
        new URL(`http://localhost/api/trash/${page.pageId}/restore`),
        "POST",
      ),
      (e: any) => e.status === 409 || e.statusCode === 409,
    );
    await client.query("DELETE FROM files WHERE id=$1", ["Xyz789"]);
    const before = (
      await client.query(
        "SELECT * FROM sources WHERE file_id=$1 ORDER BY revision",
        [page.pageId],
      )
    ).rows;
    await trash.handle(
      "fixture",
      new URL(`http://localhost/api/trash/${page.pageId}/restore`),
      "POST",
    );
    assert.deepEqual(
      (
        await client.query(
          "SELECT * FROM sources WHERE file_id=$1 ORDER BY revision",
          [page.pageId],
        )
      ).rows,
      before,
    );
    assert.deepEqual(
      (
        await client.query(
          "SELECT deleted_at,trash_path,generation FROM files WHERE id=$1",
          [page.pageId],
        )
      ).rows,
      [{ deleted_at: null, trash_path: null, generation: 2 }],
    );
    await assert.rejects(
      verifyDeletedMigrationRuntime(client, db.schema, input()),
      /owner\/head\/ACL/,
    );
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${db.schema}_migration CASCADE`);
    client.release();
    await db.cleanup();
  }
});
