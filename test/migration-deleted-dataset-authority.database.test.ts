import { testDatabase } from "./postgres.js";
import { standaloneDatasetFixture } from "./support/standalone-dataset.ts";
import { PostgresMigrationDestination } from "../src/migration/postgres.ts";
import { migrationPageDigest } from "../src/migration/import.ts";
import { planDatasetMetadata } from "../src/migration/datasets/import-metadata.ts";
import { datasetPageArtifactSha256 } from "../src/migration/dataset-pages/scan.ts";
import { additiveRowSha256 } from "../src/migration/dataset-pages/additive-authority.ts";
import { persistDeletedDatasetLifecycleLinks } from "../src/migration/deleted-dataset-authority.ts";
import type { PlannedPage } from "../src/migration/contracts.ts";
// @requires migration-database
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgresDatasetMetadataDestination } from "../src/migration/dataset-destination.ts";
import { verifyMigrationDatasetMetadata } from "../src/migration/dataset-verification.ts";
import { migrationDatasetTablePlans } from "../src/migration/dataset-table-plans.ts";
import { captureAdditiveDatasetFacts } from "../src/migration/dataset-pages/additive-authority.ts";
import { deletedDatasetBatchFingerprint } from "../src/migration/deleted-dataset-authority.ts";
import type { DatasetMigrationBatch } from "../src/migration/dataset-destination-contracts.ts";
const { Client } = createRequire(import.meta.url)("pg");
test(
  "deleted metadata preserves base receipt and protected rows; retries compare exact state and failure rolls back",
  { skip: !process.env.MIGRATION_TEST_DATABASE_URL },
  async () => {
    const db = new Client({
      connectionString: process.env.MIGRATION_TEST_DATABASE_URL,
    });
    await db.connect();
    const schema = "deleted_metadata_" + process.pid;
    const dir = await mkdtemp(join(tmpdir(), "deleted-metadata-"));
    try {
      await db.query(
        `CREATE SCHEMA ${schema}; CREATE SCHEMA ${schema}_migration; SET search_path TO ${schema}; CREATE TABLE accounts(actor text PRIMARY KEY); CREATE TABLE groups(owner text PRIMARY KEY); CREATE TABLE file_ids(id text PRIMARY KEY); CREATE TABLE files(id text PRIMARY KEY, owner text, head text, deleted_at bigint, access jsonb); CREATE TABLE sources(file_id text,revision text,content text);`,
      );
      for (const file of [
        "../src/backend/af-schema.sql",
        "../src/datasets/schema.sql",
      ])
        await db.query(await readFile(new URL(file, import.meta.url), "utf8"));
      await db.query(
        `CREATE TABLE profile_assets(source_namespace text,legacy_user_id text,asset_id text,sha256 text,byte_length bigint,width integer,height integer,content_type text,storage_key text,PRIMARY KEY(source_namespace,asset_id)); CREATE TABLE ${schema}_migration.receipts(key text,digest text,page_id text); INSERT INTO accounts VALUES ('owner'); INSERT INTO files VALUES ('Deleted1','owner','1',1,'{"visibility":"private","linkRole":"viewer","shares":{},"version":1}');`,
      );
      const base: DatasetMigrationBatch = {
        baseManifestSha256: "a".repeat(64),
        relationManifestSha256: "b".repeat(64),
        relationExportedAt: "2024-01-01T00:00:00Z",
        metadata: {
          sourceNamespace: "fixture",
          bindings: [],
          pages: [],
          resources: [],
          versions: [],
          principals: [],
          groups: [],
          acceptedJoins: [],
          profiles: [
            {
              legacyUserId: "protected",
              name: "Protected",
              handle: null,
              image: null,
            },
          ],
        },
      };
      const destination = new PostgresDatasetMetadataDestination(db, schema);
      await destination.import(base);
      const personDescriptor = {
        valueName: "self",
        backendId: "Backend01",
        backendVersion: "v1",
        pageId: "Deleted1",
        pageVersion: 1,
      };
      const choiceDescriptor = {
        name: "ownerChoice",
        column: "owner_id",
        bindingName: "data",
        schema: "public",
        table: "rows",
        sourceColumn: "owner_id",
      };
      const insertProtectedRegistrations = async () => {
        await db.query(
          "INSERT INTO dataset_person_bindings VALUES ('Backend01','v1','Deleted1',1,'self','fixture',$1)",
          [personDescriptor],
        );
        await db.query(
          "INSERT INTO dataset_user_choice_bindings VALUES ('Backend01','v1','Deleted1',1,'fixture','ownerChoice','owner_id',$1)",
          [choiceDescriptor],
        );
      };
      await insertProtectedRegistrations();
      const fingerprint = (
        await db.query(
          `SELECT fingerprint FROM ${schema}_migration.dataset_receipts`,
        )
      ).rows[0].fingerprint;
      const inventory = await captureAdditiveDatasetFacts(
        db,
        schema,
        base,
        "test",
      );
      assert.deepEqual(
        inventory.protectedRows
          .filter((r) =>
            ["dataset_person_bindings", "dataset_user_choice_bindings"].includes(
              r.table,
            ),
          )
          .map((r) => r.table)
          .sort(),
        ["dataset_person_bindings", "dataset_user_choice_bindings"],
      );
      const report = JSON.stringify({
        complete: true,
        readOnly: true,
        compilerIdentity: "test",
        runtime: { pages: 0 },
        archives: [
          { manifestSha256: base.baseManifestSha256 },
          { manifestSha256: base.relationManifestSha256 },
        ],
      });
      const path = join(dir, "report.json");
      await writeFile(path, report);
      const batch: DatasetMigrationBatch = {
        ...base,
        metadata: {
          ...base.metadata,
          profiles: [],
          resources: [
            {
              legacyId: "legacy",
              currentVersion: 1,
              policyRevision: 1,
              owner: "owner",
              generation: 1,
              access: {
                visibility: "private",
                linkRole: "viewer",
                shares: {},
                version: 1,
              },
              deleted: true,
              snapshot: {
                id: "legacy",
                owner: { userId: "owner", tokenId: null },
                visibility: "private",
                policyRevision: 1,
                ownerIsTestUser: false,
                policy: {},
              },
            },
          ],
          pages: [
            {
              pageId: "Deleted1",
              pageVersion: 1,
              snapshot: {
                standaloneDataset: {
                  kind: "dataset-self-read-v1",
                  datasetId: "legacy",
                  version: 1,
                },
                id: "legacy",
                editId: "edit",
                owner: { userId: "owner", tokenId: null },
                visibility: "private",
                format: "markup",
                deleted: true,
                ownerIsTestUser: false,
                acceptedJoinUserIds: [],
              },
            },
          ],
        },
      };
      batch.deletedAdditive = {
        kind: "deleted-dataset-additive-v1",
        sourceNamespace: "fixture",
        batchSha256: deletedDatasetBatchFingerprint(batch),
        admitted: [
          {
            legacyId: "legacy",
            pageId: "Deleted1",
            version: 1,
            artifactSha256: "c".repeat(64),
          },
        ],
        base: {
          verificationReport: {
            path,
            sha256: createHash("sha256").update(report).digest("hex"),
          },
          inventory,
        },
      };
      assert.deepEqual(await destination.import(batch), {
        created: 2,
        unchanged: 0,
      });
      await db.query(
        "DELETE FROM dataset_person_bindings WHERE backend_id='Backend01'; DELETE FROM dataset_user_choice_bindings WHERE backend_id='Backend01'",
      );
      await assert.rejects(destination.import(batch), /protected|missing/i);
      await insertProtectedRegistrations();
      assert.deepEqual(await destination.import(batch), {
        created: 0,
        unchanged: 2,
      });
      await verifyMigrationDatasetMetadata(db, schema, batch);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM dataset_deleted_page_lifecycle_links",
          )
        ).rows[0].count,
        1,
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM dataset_deleted_lifecycle_links",
          )
        ).rows[0].count,
        1,
      );
      await assert.rejects(
        db.query(
          "UPDATE dataset_deleted_page_lifecycle_links SET authority_sha256=$1",
          ["f".repeat(64)],
        ),
      );
      await assert.rejects(
        db.query(
          "INSERT INTO dataset_deleted_lifecycle_links VALUES('fixture','other','Deleted1',$1)",
          ["f".repeat(64)],
        ),
      );
      const resealed = structuredClone(batch);
      resealed.deletedAdditive!.admitted[0]!.artifactSha256 = "f".repeat(64);
      await assert.rejects(destination.import(resealed), /lifecycle link/);

      assert.equal(
        (
          await db.query(
            `SELECT fingerprint FROM ${schema}_migration.dataset_receipts`,
          )
        ).rows[0].fingerprint,
        fingerprint,
      );
      assert.equal(
        (
          await db.query(
            "SELECT snapshot->>'deleted' AS deleted FROM dataset_pages",
          )
        ).rows[0].deleted,
        "true",
      );
      const changed = structuredClone(batch);
      changed.metadata.pages[0]!.snapshot.visibility = "public";
      await assert.rejects(destination.import(changed));
      await assert.rejects(
        db.query("UPDATE dataset_public_profiles SET name='Changed'"),
      );
      await db.query(
        `DELETE FROM ${schema}_migration.dataset_deleted_additive_receipts; ALTER TABLE dataset_deleted_lifecycle_links DISABLE TRIGGER dataset_deleted_lifecycle_links_immutable; DELETE FROM dataset_deleted_lifecycle_links; ALTER TABLE dataset_deleted_lifecycle_links ENABLE TRIGGER dataset_deleted_lifecycle_links_immutable; ALTER TABLE dataset_deleted_page_lifecycle_links DISABLE TRIGGER dataset_deleted_page_lifecycle_links_immutable; DELETE FROM dataset_deleted_page_lifecycle_links; ALTER TABLE dataset_deleted_page_lifecycle_links ENABLE TRIGGER dataset_deleted_page_lifecycle_links_immutable; DELETE FROM dataset_pages; DELETE FROM dataset_resources; CREATE FUNCTION reject_deleted_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'link failure'; END $$; CREATE TRIGGER reject_deleted_link BEFORE INSERT ON dataset_deleted_page_lifecycle_links FOR EACH ROW EXECUTE FUNCTION reject_deleted_link();`,
      );
      await assert.rejects(destination.import(batch), /link failure/);
      assert.equal(
        (await db.query("SELECT count(*)::int AS count FROM dataset_pages"))
          .rows[0].count,
        0,
      );
    } finally {
      await db.query(
        `DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP SCHEMA IF EXISTS ${schema}_migration CASCADE`,
      );
      await db.end();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("actual deleted page ACL revision differs from preserved legacy resource revision without changing ACL semantics", async () => {
  const db = await testDatabase();
  const client = await db.pool.connect();
  const f = standaloneDatasetFixture();
  f.artifact.deleted_at = "2020-01-02T03:04:05.000Z";
  f.artifact.sharing_revision = 7;
  const manifest = {
    ...f.source.base,
    artifacts: [f.artifact],
    tables: { ...f.source.base.tables, relations: [] },
  };
  const originalSha = additiveRowSha256(f.artifact);
  const admission = {
    kind: "deleted-artifact-admission-v1" as const,
    sourceNamespace: "fixture",
    archiveDigest: "a".repeat(64),
    entries: [
      {
        legacyId: f.artifact.id,
        pageId: "Data01",
        headVersion: 1,
        deletedAt: String(f.artifact.deleted_at),
        artifactSha256: originalSha,
        revisions: [{ version: 1, artifactSha256: originalSha }],
      },
    ],
  };
  const page: PlannedPage = {
    legacyId: f.artifact.id,
    pageId: "Data01",
    owner: { kind: "user", id: f.source.maps.users.owner! },
    disposition: "ready",
    issues: [],
    original: f.artifact,
    access: { visibility: "private", linkRole: "viewer", shares: [] },
    comments: [],
    identities: [],
    revisions: [
      {
        version: 1,
        original: f.artifact,
        conversion: {
          classification: "renderable",
          html: '<!doctype html><html><body><p data-af-id="retained">Retained</p></body></html>',
          issues: [],
          identities: {},
        },
      },
    ],
  };
  try {
    const writer = new PostgresMigrationDestination(client, {
      schema: db.schema,
      sourceNamespace: "fixture",
      origin: "http://localhost:8787",
      isolated: true,
      editorManageRestricted: true,
    });
    await writer.prepare({ manifest, maps: f.source.maps });
    await writer.prepareDeleted({
      sourceNamespace: "fixture",
      archiveDigest: createHash("sha256")
        .update(JSON.stringify(manifest))
        .digest("hex"),
      maps: f.source.maps,
    });
    await writer.importDeletedPage(
      "fixture:" + page.legacyId,
      migrationPageDigest(page),
      page,
    );
    const planned = planDatasetMetadata({
      manifest,
      maps: f.source.maps,
      receipts: f.source.datasets!.receipts,
      deletedAdmission: admission,
      relationProvenance: {
        exportedAt: f.source.base.exportedAt,
        manifestSha256: "b".repeat(64),
      },
      bindings: [
        {
          pageLegacyId: f.artifact.id,
          pageId: "Data01",
          pageVersion: 1,
          backendId: "Back01",
          backendVersion: "c".repeat(64),
          backendNamespace: "legacyData",
          name: "data",
          legacyRef: "ref:" + f.artifact.id,
          datasetLegacyId: f.artifact.id,
          datasetVersion: 1,
          standaloneDataset: {
            sourceFormat: "dataset",
            legacyId: f.artifact.id,
            pageId: "Data01",
            pageVersion: 1,
            editId: String(f.artifact.edit_id),
            artifactSha256: datasetPageArtifactSha256(f.artifact),
          },
        },
      ],
    });
    assert.equal(planned.metadata.pages.length, 1);
    const batch: DatasetMigrationBatch = {
      baseManifestSha256: "a".repeat(64),
      relationManifestSha256: "b".repeat(64),
      relationExportedAt: f.source.base.exportedAt,
      metadata: planned.metadata,
    };
    batch.deletedAdditive = {
      kind: "deleted-dataset-additive-v1",
      sourceNamespace: "fixture",
      batchSha256: deletedDatasetBatchFingerprint(batch),
      admitted: [
        {
          legacyId: f.artifact.id,
          pageId: "Data01",
          version: 1,
          artifactSha256: originalSha,
        },
      ],
      base: {
        verificationReport: { path: "offline", sha256: "a".repeat(64) },
        inventory: {
          sourceNamespace: "fixture",
          datasetFingerprint: "a".repeat(64),
          resources: [],
          baseManifestSha256: batch.baseManifestSha256,
          relationManifestSha256: batch.relationManifestSha256,
          relationExportedAt: batch.relationExportedAt,
          compilerIdentity: "test",
          reservedFileIds: [],
          protectedRows: [],
          backendRows: [],
          pageReceipts: [],
          sources: [],
          tables: [],
        },
      },
    };
    const resource = planned.metadata.resources[0]!;
    const actual = (
      await client.query(
        `SELECT access FROM ${db.schema}.files WHERE id='Data01'`,
      )
    ).rows[0].access;
    assert.equal(actual.version, 0);
    assert.equal(resource.access.version, 7);
    const plan = migrationDatasetTablePlans(batch).find(
      (p) => p.table === "dataset_resources",
    )!;
    for (const row of plan.rows) {
      const columns = Object.keys(row);
      await client.query(
        `INSERT INTO ${db.schema}.dataset_resources (${columns.join(",")}) VALUES (${columns.map((_, i) => "$" + (i + 1)).join(",")})`,
        columns.map((c) =>
          plan.json.includes(c) ? JSON.stringify(row[c]) : row[c],
        ),
      );
    }
    await client.query("BEGIN");
    await persistDeletedDatasetLifecycleLinks(client, db.schema, batch, false);
    await client.query("COMMIT");
    assert.equal(
      (
        await client.query(
          `SELECT count(*)::int AS count FROM ${db.schema}.dataset_deleted_lifecycle_links`,
        )
      ).rows[0].count,
      1,
    );
    assert.equal(resource.access.version, 7);
    assert.equal(
      (
        await client.query(
          `SELECT access FROM ${db.schema}.dataset_resources WHERE legacy_id=$1`,
          [f.artifact.id],
        )
      ).rows[0].access.version,
      7,
    );
    for (const changed of [
      { ...actual, linkRole: "editor" },
      { ...actual, visibility: "public" },
      { ...actual, shares: { "reader@example.test": "viewer" } },
    ]) {
      await client.query(
        `UPDATE ${db.schema}.files SET access=$1::jsonb WHERE id='Data01'`,
        [JSON.stringify(changed)],
      );
      await assert.rejects(
        persistDeletedDatasetLifecycleLinks(client, db.schema, batch, true),
        /authority differs|association differs/,
      );
    }
  } finally {
    client.release();
    await db.cleanup();
  }
});
