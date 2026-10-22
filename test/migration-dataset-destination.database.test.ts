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
              expiresAt: "2027-01-01T00:00:00.000Z",
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
    } finally {
      await db.query(
        `DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP SCHEMA IF EXISTS ${schema}_migration CASCADE`,
      );
      await db.end();
    }
  },
);
