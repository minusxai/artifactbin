// @requires migration-database
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { planMigration, applyMigration } from "../src/migration/import.ts";
import {
  PostgresMigrationDestination,
  buildAccountMaps,
} from "../src/migration/postgres.ts";
import { verifyMigrationRuntime } from "../src/migration/page-verification.ts";
import { sourceDigest } from "../src/server/page-ports.ts";
import type { MigrationManifest } from "../src/migration/contracts.ts";
const { Client } = createRequire(import.meta.url)("pg");
test(
  "historical unavailable import retains immutable original, all saved versions and canonical revisions on retry",
  { skip: !process.env.MIGRATION_TEST_DATABASE_URL },
  async () => {
    const db = new Client({
      connectionString: process.env.MIGRATION_TEST_DATABASE_URL,
    });
    await db.connect();
    const schema = "history_unavailable_" + process.pid;
    try {
      const original = '<script>throw "synthetic-secret"</script>';
      const manifest: MigrationManifest = {
        schemaVersion: 1,
        sourceNamespace: "fixture-history",
        exportedAt: "epoch",
        tokenOwners: [],
        tables: {
          users: [{ id: "owner", email: "owner@example.test" }],
          artifact_versions: [
            {
              artifact_id: "abc123",
              version: 1,
              format: "markup",
              source: original,
            },
          ],
        },
        artifacts: [
          {
            id: "abc123",
            version: 2,
            format: "markup",
            user_id: "owner",
            group_id: null,
            token_id: null,
            source: "current",
            document: null,
            visibility: "private",
            link_role: "viewer",
          },
        ],
      };
      const plan = await planMigration(manifest, {
        maps: buildAccountMaps(manifest),
        coreUrl: "/af/v1/core.js",
        historicalUnavailable: "preserve",
        convert: ({ source }) =>
          source === "current"
            ? {
                classification: "functional",
                html: '<html><body><p data-af-id="head">Current</p></body></html>',
                identities: {},
                issues: [],
              }
            : {
                classification: "manual-blocked",
                html: null,
                identities: {},
                issues: [{ code: "compiled-source" }],
              },
      });
      const destination = new PostgresMigrationDestination(db, {
        schema,
        origin: "http://localhost:8787",
        isolated: true,
        editorManageRestricted: true,
      });
      await destination.prepare({ manifest, maps: plan.maps });
      assert.deepEqual(
        await applyMigration(plan, destination, { dryRun: false }),
        { created: 1, unchanged: 0, blocked: 0 },
      );
      assert.deepEqual(
        await applyMigration(plan, destination, { dryRun: false }),
        { created: 0, unchanged: 1, blocked: 0 },
      );
      const sources = (
        await db.query(
          `SELECT revision,content,digest FROM ${schema}.sources WHERE file_id='abc123' ORDER BY revision::bigint`,
        )
      ).rows;
      assert.deepEqual(
        sources.map((r: { revision: string }) => r.revision),
        ["1", "2"],
      );
      assert.match(sources[0].content, /Historical version 1 unavailable/);
      assert.doesNotMatch(sources[0].content, /synthetic-secret|throw/);
      assert.match(sources[1].content, /Current/);
      for (const row of sources)
        assert.equal(row.digest, sourceDigest(row.content));
      const archived = (
        await db.query(
          `SELECT manifest FROM ${schema}_migration.archives WHERE namespace='fixture-history'`,
        )
      ).rows[0].manifest;
      assert.equal(archived.tables.artifact_versions[0].source, original);
      await verifyMigrationRuntime(db, schema, {
        pages: (async function* () {
          yield* plan.pages;
        })(),
        maps: plan.maps,
        origin: "http://localhost:8787",
      });
      const tampered = structuredClone(plan);
      tampered.pages[0]!.revisions[0]!.conversion.historicalUnavailable!.originalRecordSha256 =
        "f".repeat(64);
      await assert.rejects(
        applyMigration(tampered, destination, { dryRun: false }),
        /receipt conflicts/,
      );
      await assert.rejects(
        verifyMigrationRuntime(db, schema, {
          pages: (async function* () {
            yield* tampered.pages;
          })(),
          maps: plan.maps,
          origin: "http://localhost:8787",
        }),
        /receipt provenance/,
      );
      const changedArchive = structuredClone(manifest);
      changedArchive.tables.artifact_versions![0]!.source = "changed";
      await assert.rejects(
        destination.prepare({ manifest: changedArchive, maps: plan.maps }),
        /Source archive changed/,
      );
    } finally {
      await db.query(
        `DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP SCHEMA IF EXISTS ${schema}_migration CASCADE`,
      );
      await db.end();
    }
  },
);
