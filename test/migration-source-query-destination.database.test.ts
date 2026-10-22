// @requires migration-database
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { PostgresDatasetMetadataDestination } from "../src/migration/dataset-destination.ts";
import { verifyMigrationDatasetMetadata } from "../src/migration/dataset-verification.ts";
import { planDatasetMetadata } from "../src/migration/datasets/import-metadata.ts";
const { Client } = createRequire(import.meta.url)("pg");
test(
  "source query publication requires canonical backend/viewer authority and retry cannot recreate removed operations",
  { skip: !process.env.MIGRATION_TEST_DATABASE_URL },
  async () => {
    const db = new Client({
      connectionString: process.env.MIGRATION_TEST_DATABASE_URL,
    });
    await db.connect();
    const schema = "migration_source_" + process.pid;
    try {
      await db.query(
        `CREATE SCHEMA ${schema}; CREATE SCHEMA ${schema}_migration; SET search_path TO ${schema}; CREATE TABLE accounts(actor text PRIMARY KEY); CREATE TABLE groups(owner text PRIMARY KEY); CREATE TABLE files(id text PRIMARY KEY);`,
      );
      for (const file of [
        "../src/backend/af-schema.sql",
        "../src/datasets/schema.sql",
      ])
        await db.query(await readFile(new URL(file, import.meta.url), "utf8"));
      await db.query(
        `CREATE TABLE profile_assets(source_namespace text,legacy_user_id text,asset_id text,sha256 text,byte_length bigint,width integer,height integer,content_type text,storage_key text,PRIMARY KEY(source_namespace,asset_id)); INSERT INTO accounts VALUES('owner@example.test'); INSERT INTO files VALUES('Page01');`,
      );
      const page = {
        id: "legacy",
        edit_id: "saved",
        version: 1,
        format: "markup",
        source: "<p>Source query</p>",
        document: null,
        user_id: "owner",
        group_id: null,
        token_id: "",
        visibility: "private",
        link_role: "viewer",
      };
      const metadata = planDatasetMetadata({
        manifest: {
          schemaVersion: 1,
          sourceNamespace: "fixture",
          exportedAt: new Date(0).toISOString(),
          artifacts: [page],
          tables: { relations: [], users: [{ id: "owner", kind: "account" }] },
          tokenOwners: [],
        },
        maps: {
          users: { owner: "owner@example.test" },
          tokens: {},
          groups: {},
          pages: { legacy: "Page01" },
        },
        receipts: [],
        bindings: [],
        sourceQueryPages: [
          { pageLegacyId: "legacy", pageId: "Page01", pageVersion: 1 },
        ],
        relationProvenance: {
          exportedAt: new Date(0).toISOString(),
          manifestSha256: "a".repeat(64),
        },
      }).metadata;
      const sql = "select 1 as value",
        registration = {
          pageLegacyId: "legacy",
          pageVersion: 1,
          name: "q",
          sourceRef: "ref:source01",
          resource: "source-source01",
          sql,
          sqlSha256: createHash("sha256").update(sql).digest("hex"),
          params: {},
          columns: [{ name: "value", type: "number" as const }],
        };
      const version = "b".repeat(64),
        receipt = {
          pageLegacyId: "legacy",
          pageId: "Page01",
          pageVersion: 1,
          backendId: "Back01",
          deployment: { version },
        };
      const batch = {
        baseManifestSha256: "a".repeat(64),
        relationManifestSha256: "c".repeat(64),
        relationExportedAt: new Date(0).toISOString(),
        metadata,
        sourceQueryRegistrations: [{ receipt, queries: [registration] }],
      };
      const destination = new PostgresDatasetMetadataDestination(
        db,
        schema,
        undefined,
        [registration],
      );
      await assert.rejects(
        destination.import(batch),
        /compiled backend\/page\/viewer authority/,
      );
      await db.query(
        `INSERT INTO af_backend_files(file_id,owner,head_version) VALUES('Back01','owner@example.test',$1) ON CONFLICT DO NOTHING`,
        [version],
      );
      await db.query(
        `INSERT INTO af_backend_versions(file_id,version,page_id,page_version,type_defs,deployment) VALUES('Back01',$1,'Page01',1,'type Query{x:Int}','{}') ON CONFLICT DO NOTHING`,
        [version],
      );
      await db.query(
        `INSERT INTO af_page_backends VALUES('Page01',1,0,'legacyData','Back01',$1)`,
        [version],
      );
      await assert.rejects(
        destination.import(batch),
        /compiled backend\/page\/viewer authority/,
      );
      await db.query(
        `INSERT INTO dataset_viewer_bindings VALUES('Back01',$1,'Page01',1,'fixture')`,
        [version],
      );
      await destination.import(batch);
      await destination.import(batch);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM dataset_source_queries",
          )
        ).rows[0].n,
        1,
      );
      await verifyMigrationDatasetMetadata(db, schema, batch, undefined, [
        registration,
      ]);
      await db.query(
        "ALTER TABLE dataset_source_queries DISABLE TRIGGER dataset_source_queries_immutable; DELETE FROM dataset_source_queries; ALTER TABLE dataset_source_queries ENABLE TRIGGER dataset_source_queries_immutable",
      );
      await assert.rejects(destination.import(batch), /registration conflict/);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM dataset_source_queries",
          )
        ).rows[0].n,
        0,
      );
      await assert.rejects(
        verifyMigrationDatasetMetadata(db, schema, batch, undefined, [
          registration,
        ]),
        /registration conflict/,
      );
    } finally {
      await db.query(
        `DROP SCHEMA IF EXISTS ${schema}_migration CASCADE; DROP SCHEMA IF EXISTS ${schema} CASCADE`,
      );
      await db.end();
    }
  },
);
