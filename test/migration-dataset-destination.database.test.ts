import { verifyMigrationDatasetMetadata } from "../src/migration/dataset-verification.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { PostgresDatasetMetadataDestination } from "../src/migration/dataset-destination.ts";
import type { DatasetMigrationBatch } from "../src/migration/dataset-destination-contracts.ts";
const { Client } = createRequire(import.meta.url)("pg");
test(
  "dataset metadata is durable, idempotent, immutable and cannot restore revoked principals",
  { skip: !process.env.MIGRATION_TEST_DATABASE_URL },
  async () => {
    const db = new Client({
      connectionString: process.env.MIGRATION_TEST_DATABASE_URL,
    });
    await db.connect();
    const schema = "migration_dataset_" + process.pid;
    try {
      await db.query(
        `CREATE SCHEMA ${schema}; CREATE SCHEMA ${schema}_migration; SET search_path TO ${schema}; CREATE TABLE accounts(actor text PRIMARY KEY); CREATE TABLE groups(owner text PRIMARY KEY); CREATE TABLE files(id text PRIMARY KEY);`,
      );
      await db.query(
        await readFile(
          new URL("../src/datasets/schema.sql", import.meta.url),
          "utf8",
        ),
      );
      await db.query(`INSERT INTO accounts VALUES ('owner@example.test')`);
      const batch: DatasetMigrationBatch = {
        baseManifestSha256: "a".repeat(64),
        relationManifestSha256: "b".repeat(64),
        relationExportedAt: "2026-10-22T00:00:00.000Z",
        metadata: {
          sourceNamespace: "fixture",
          bindings: [],
          pages: [],
          resources: [],
          versions: [],
          groups: [],
          acceptedJoins: [],
          principals: [
            {
              actor: "owner@example.test",
              kind: "user",
              legacyId: "original-user",
              identity: "user",
              expiresAt: "2027-01-01T00:00:00+00:00",
            },
          ],
        },
      };
      const destination = new PostgresDatasetMetadataDestination(db, schema);
      assert.deepEqual(await destination.import(batch), {
        created: 1,
        unchanged: 0,
      });
      assert.deepEqual(await destination.import(batch), {
        created: 0,
        unchanged: 1,
      });
      assert.equal(await verifyMigrationDatasetMetadata(db, schema, batch), 1);
      await db.query(
        "UPDATE dataset_principals SET expires_at='2028-01-01' WHERE source_namespace='fixture'",
      );
      await assert.rejects(
        verifyMigrationDatasetMetadata(db, schema, batch),
        /dataset policy/,
      );
      await db.query(
        "UPDATE dataset_principals SET expires_at='2027-01-01' WHERE source_namespace='fixture'",
      );
      const changed = structuredClone(batch);
      changed.metadata.principals = [
        { ...batch.metadata.principals[0]!, actor: "other@example.test" },
      ];
      await assert.rejects(
        destination.import(changed),
        /Existing dataset metadata differs/,
      );
      await db.query("DELETE FROM dataset_principals");
      await assert.rejects(destination.import(batch), /removed after import/);
      assert.equal(
        (await db.query("SELECT count(*)::int AS n FROM dataset_principals"))
          .rows[0].n,
        0,
      );
      await db.query(
        await readFile(
          new URL("../src/backend/af-schema.sql", import.meta.url),
          "utf8",
        ),
      );
      await db.query(
        `INSERT INTO files VALUES ('abc123'); INSERT INTO af_backend_files(file_id,owner,head_version) VALUES ('def456','owner@example.test','version1'); INSERT INTO af_backend_versions(file_id,version,page_id,page_version,type_defs,deployment) VALUES ('def456','version1','abc123',1,'fixture','{}'); INSERT INTO af_page_backends VALUES ('abc123',1,0,'legacyDatasets','def456','version1'); INSERT INTO dataset_resources VALUES ('bound','dataset',1,0,'owner@example.test',1,'{}',false,'{}',false); INSERT INTO dataset_versions VALUES ('bound','dataset',1,'[]','{}','[]')`,
      );
      const bound: DatasetMigrationBatch = {
        ...batch,
        metadata: {
          ...batch.metadata,
          sourceNamespace: "bound",
          principals: [],
          pages: [
            {
              pageId: "abc123",
              pageVersion: 1,
              snapshot: {
                id: "legacy-page",
                editId: "edit",
                owner: { userId: "original-user", tokenId: null },
                visibility: "private",
                format: "markup",
                deleted: false,
                ownerIsTestUser: false,
                acceptedJoinUserIds: [],
              },
            },
          ],
          bindings: [
            {
              name: "sales",
              mode: "live",
              backendId: "def456",
              backendVersion: "version1",
              page: {
                id: "abc123",
                version: 1,
                legacyId: "legacy-page",
                editId: "edit",
              },
              dataset: { id: "dataset", version: 1, policyRevision: 0 },
              tables: [],
            },
          ],
        },
      };
      bound.metadata.acceptedJoins = [
        {
          pageId: "abc123",
          legacyUserId: "joined-user",
          joinedAt: "2026-10-21T12:30:00+05:30",
        },
        { pageId: "abc123", legacyUserId: "historical-user" },
      ];
      const binding = bound.metadata.bindings[0]!;
      bound.metadata.operations = [
        {
          sourceNamespace: "bound",
          bindingName: "sales",
          operation: {
            name: "change",
            backendId: binding.backendId,
            backendVersion: binding.backendVersion,
            page: binding.page,
            datasetId: "dataset",
            target: { schema: "public", table: "rows" },
            sqlSchema: "sales",
            sql: "delete from sales.rows",
            paramTypes: {},
            conflictMode: "refuse",
          },
        },
      ];
      assert.deepEqual(await destination.import(bound), {
        created: 4,
        unchanged: 0,
      });
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM dataset_mutation_operations",
          )
        ).rows[0].n,
        1,
      );
      await destination.import(bound);
      assert.deepEqual(
        (
          await db.query(
            "SELECT legacy_user_id,joined_at FROM dataset_page_joins ORDER BY legacy_user_id",
          )
        ).rows.map((r: { legacy_user_id: string; joined_at: Date | null }) => ({
          ...r,
          joined_at: r.joined_at?.toISOString() ?? null,
        })),
        [
          { legacy_user_id: "historical-user", joined_at: null },
          {
            legacy_user_id: "joined-user",
            joined_at: "2026-10-21T07:00:00.000Z",
          },
        ],
      );
      // Include directly seeded authority rows so the independent verifier checks the full namespace.
      const verified = structuredClone(bound);
      verified.metadata.resources = [
        {
          legacyId: "dataset",
          currentVersion: 1,
          policyRevision: 0,
          owner: "owner@example.test",
          generation: 1,
          access: {},
          deleted: false,
          snapshot: {},
          writable: false,
        },
      ] as typeof verified.metadata.resources;
      verified.metadata.versions = [
        {
          legacyId: "dataset",
          version: 1,
          tables: [],
          catalog: {},
          unavailableTables: [],
        },
      ];
      await verifyMigrationDatasetMetadata(db, schema, verified);
      await db.query(
        "UPDATE dataset_page_joins SET joined_at='2026-01-01' WHERE legacy_user_id='joined-user'",
      );
      await assert.rejects(
        verifyMigrationDatasetMetadata(db, schema, verified),
        /dataset policy/,
      );
      await db.query(
        "UPDATE dataset_page_joins SET joined_at='2026-10-21T07:00:00Z' WHERE legacy_user_id='joined-user'",
      );
      await db.query("DELETE FROM dataset_mutation_operations");
      await assert.rejects(destination.import(bound), /operation was removed/);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM dataset_mutation_operations",
          )
        ).rows[0].n,
        0,
      );
      const wrong = structuredClone(bound);
      wrong.metadata.bindings = [
        { ...bound.metadata.bindings[0]!, backendVersion: "wrong-version" },
      ];
      await assert.rejects(
        destination.import(wrong),
        /existing compiled backend/,
      );
    } finally {
      await db.query(
        `DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP SCHEMA IF EXISTS ${schema}_migration CASCADE`,
      );
      await db.end();
    }
  },
);
