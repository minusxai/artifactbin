// @requires migration-database
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { testDatabase } from "./postgres.js";
import { planMigration, migrationPageDigest } from "../src/migration/import.ts";
import {
  PostgresMigrationDestination,
  buildAccountMaps,
} from "../src/migration/postgres.ts";
import { prepareMigrationBackends } from "../src/migration/backend-preparation.ts";
import { readBackendModule } from "../src/backend/af-module.ts";
import { boundedBackendSchema } from "../src/graphql/execution-policy.ts";
import { sealDeployment } from "../src/backend/deployment.ts";
import { canonicalMigrationValue } from "../src/migration/verification-values.ts";
import type { MigrationManifest } from "../src/migration/contracts.ts";
test("deleted lifecycle importer publishes viewer backend while file remains inactive", async () => {
  const db = await testDatabase(),
    client = await db.pool.connect();
  const manifest: MigrationManifest = {
    schemaVersion: 1,
    sourceNamespace: "inactive-fixture",
    exportedAt: "epoch",
    tokenOwners: [],
    tables: { users: [{ id: "owner", email: "owner@example.test" }] },
    artifacts: [
      {
        id: "Old123",
        version: 1,
        format: "markup",
        source: "saved",
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
        convert: () => ({
          classification: "functional",
          html: "<html><body><p>saved</p></body></html>",
          identities: {},
          issues: [],
        }),
      }),
      page = plan.pages[0]!;
    page.original.deleted_at = "2026-01-01T00:00:00.000Z";
    manifest.artifacts[0]!.deleted_at = page.original.deleted_at;
    const prepared = await prepareMigrationBackends(
      {
        sourceNamespace: manifest.sourceNamespace,
        origin: options.origin,
        allocatedIds: [page.pageId],
        pages: [
          {
            legacyId: page.legacyId,
            pageId: page.pageId,
            owner: {kind:"user",id:page.owner!.id},
            revisions: [{ version: 1, imports: [], readsViewer: true }],
          },
        ],
      },
      {
        host: {
          invoke:async()=>{throw Error("compile-only fixture");},
          compile: async (source) => {
            const info = await readBackendModule(source),
              schema = boundedBackendSchema(info.typeDefs);
            return sealDeployment(source, "fixture compiled bundle", {
              typeDefs: info.typeDefs,
              fields: [
                ...Object.keys(schema.getQueryType()?.getFields() ?? {}),
                ...Object.keys(schema.getMutationType()?.getFields() ?? {}),
              ],
            });
          },
        },
      },
    );
    page.backends = prepared.receipts;
    const destination = new PostgresMigrationDestination(client, options);
    await destination.prepare({ manifest, maps: plan.maps });
    await destination.prepareDeleted({
      sourceNamespace: manifest.sourceNamespace,
      archiveDigest: createHash("sha256")
        .update(JSON.stringify(manifest))
        .digest("hex"),
      maps: plan.maps,
      publications: [
        {
          kind: "deleted-migration-publication-v1",
          sourceNamespace: manifest.sourceNamespace,
          archiveDigest: createHash("sha256")
            .update(JSON.stringify(manifest))
            .digest("hex"),
          admissionSha256: "b".repeat(64),
          legacyId: page.legacyId,
          pageId: page.pageId,
          headVersion: 1,
          deletedAt: String(page.original.deleted_at),
          artifactSha256: createHash("sha256")
            .update(canonicalMigrationValue(page.original))
            .digest("hex"),
        },
      ],
    });
    const key = manifest.sourceNamespace + ":" + page.legacyId,
      digest = migrationPageDigest(page);
    assert.equal(
      await destination.importDeletedPage(key, digest, page),
      "created",
    );
    assert.equal(
      await destination.importDeletedPage(key, digest, page),
      "unchanged",
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int n FROM dataset_viewer_bindings",
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await client.query("SELECT deleted_at::text FROM files WHERE id=$1", [
          page.pageId,
        ])
      ).rows[0].deleted_at,
      String(Date.parse(String(page.original.deleted_at))),
    );
  } finally {
    client.release();
    await db.pool.query(`DROP SCHEMA IF EXISTS ${db.schema}_migration CASCADE`);
    await db.cleanup();
  }
});
