import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { testDatabase } from "./postgres.js";
import {
  standaloneDatasetFixture,
  standaloneDatasetHost,
} from "./support/standalone-dataset.ts";
import { PostgresMigrationDestination } from "../src/migration/postgres.ts";
import { PostgresDatasetMetadataDestination } from "../src/migration/dataset-destination.ts";
import { verifyMigrationDatasetMetadata } from "../src/migration/dataset-verification.ts";
import {
  captureAdditiveDatasetBase,
  verifyAdditiveDatasetBase,
} from "../src/migration/dataset-pages/additive-authority.ts";
import { prepareMigrationJobDatasets } from "../src/migration/job-datasets.ts";
import { createMigrationJobPlanner } from "../src/migration/job-planning.ts";
import { applyMigration } from "../src/migration/import.ts";
import type { DatasetMigrationBatch } from "../src/migration/dataset-destination-contracts.ts";

test("additive normal publication preserves its completed base receipt, replays exactly, verifies union and refuses changed/removed authority", async () => {
  const db = await testDatabase();
  const client = await db.pool.connect();
  const dir = await mkdtemp(join(tmpdir(), "dataset-additive-"));
  const { source, options } = standaloneDatasetFixture();
  options.schema = db.schema;
  const destination = new PostgresMigrationDestination(client, {
    schema: db.schema,
    sourceNamespace: "fixture",
    isolated: true,
    editorManageRestricted: true,
    origin: options.origin,
  });
  try {
    await destination.prepare({ manifest: source.base, maps: source.maps });
    const metadata = new PostgresDatasetMetadataDestination(client, db.schema);
    const base: DatasetMigrationBatch = {
      ...source.datasets!.provenance,
      metadata: {
        sourceNamespace: "fixture",
        bindings: [],
        pages: [],
        resources: [],
        versions: [],
        principals: [
          {
            kind: "user",
            legacyId: "owner",
            actor: "owner@example.test",
            identity: "user",
            expiresAt: null,
          },
        ],
        groups: [],
        acceptedJoins: [],
      },
    };
    const originalDataset = await prepareMigrationJobDatasets(source, options, {
      host: standaloneDatasetHost,
    });
    base.metadata.resources = originalDataset!.metadata.resources;
    base.metadata.versions = originalDataset!.metadata.versions;
    await metadata.import(base);
    await verifyMigrationDatasetMetadata(client, db.schema, base);
    const original = (
      await client.query(
        `SELECT * FROM "${db.schema}_migration".dataset_receipts`,
      )
    ).rows;
    const report = {
      complete: true,
      readOnly: true,
      compilerIdentity: "fixture",
      runtime: { pages: 0 },
      archives: [
        { manifestSha256: base.baseManifestSha256 },
        { manifestSha256: base.relationManifestSha256 },
      ],
    };
    const bytes = JSON.stringify(report);
    const path = join(dir, "verified.json");
    await writeFile(path, bytes);
    options.standaloneDatasetPages!.base = await captureAdditiveDatasetBase(
      client,
      db.schema,
      base,
      { path, sha256: createHash("sha256").update(bytes).digest("hex") },
    );
    const prepared = await prepareMigrationJobDatasets(source, options, {
      host: standaloneDatasetHost,
    });
    assert.ok(prepared);
    source.preparedDatasets = prepared;
    const plan = await createMigrationJobPlanner(source, options, async () => {
      throw Error("not legacy markup");
    })(await source.readArtifact("data01"));
    await assert.rejects(
      () =>
        verifyAdditiveDatasetBase(client, db.schema, {
          ...base,
          additive: options.standaloneDatasetPages,
          metadata: {
            ...prepared.metadata,
            resources: prepared.metadata.resources.map((r) => ({
              ...r,
              generation: r.generation + 1,
            })),
          },
        }),
      /attempted base replacement/,
    );
    const result = await applyMigration(plan, destination, { dryRun: false });
    assert.equal(result.created, 1);
    const batch: DatasetMigrationBatch = {
      ...base,
      metadata: prepared.metadata,
      additive: options.standaloneDatasetPages,
    };
    const added = await metadata.import(batch);
    assert.ok(added.created > 0);
    assert.equal((await metadata.import(batch)).created, 0);
    assert.ok(
      (await verifyMigrationDatasetMetadata(client, db.schema, batch)) > 0,
    );
    assert.deepEqual(
      (
        await client.query(
          `SELECT * FROM "${db.schema}_migration".dataset_receipts`,
        )
      ).rows,
      original,
    );
    const receiptRows = (
      await client.query(
        `SELECT * FROM "${db.schema}_migration".dataset_additive_receipts`,
      )
    ).rows;
    assert.equal(receiptRows.length, 1);
    await assert.rejects(
      () =>
        metadata.import({
          ...batch,
          metadata: {
            ...batch.metadata,
            resources: batch.metadata.resources.map((r) => ({
              ...r,
              generation: r.generation + 1,
            })),
          },
        }),
      /differs|changed|Unexpected/,
    );
    await client.query(
      `UPDATE "${db.schema}".dataset_principals SET expires_at='2000-01-01' WHERE kind='user'`,
    );
    await assert.rejects(() => metadata.import(batch), /base changed/);
    await client.query(
      `UPDATE "${db.schema}".dataset_principals SET expires_at=NULL WHERE kind='user'`,
    );
    await client.query(`DELETE FROM "${db.schema}".dataset_bindings`);
    await assert.rejects(() => metadata.import(batch), /removed after import/);
    await writeFile(path, JSON.stringify({ ...report, complete: false }));
    await assert.rejects(
      () => verifyAdditiveDatasetBase(client, db.schema, batch),
      /report changed/,
    );
  } finally {
    await client.query(
      `DROP SCHEMA IF EXISTS "${db.schema}_migration" CASCADE`,
    );
    client.release();
    await db.cleanup();
    await rm(dir, { recursive: true, force: true });
  }
});
