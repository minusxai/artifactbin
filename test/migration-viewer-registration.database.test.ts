import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { registerMigrationViewerBinding } from "../src/migration/viewer-registration.ts";
const { Client } = createRequire(import.meta.url)("pg");
test(
  "viewer provenance requires an exact current canonical backend and cannot change namespace",
  { skip: !process.env.MIGRATION_TEST_DATABASE_URL },
  async () => {
    const db = new Client({
      connectionString: process.env.MIGRATION_TEST_DATABASE_URL,
    });
    await db.connect();
    const schema = "migration_viewer_" + process.pid;
    try {
      await db.query(
        `CREATE SCHEMA ${schema}; SET search_path TO ${schema}; CREATE TABLE accounts(actor text PRIMARY KEY); CREATE TABLE groups(owner text PRIMARY KEY); CREATE TABLE files(id text PRIMARY KEY,head text,deleted_at bigint); CREATE TABLE af_page_backends(file_id text,version text,page_id text,page_version bigint);`,
      );
      await db.query(
        await readFile(
          new URL("../src/datasets/schema.sql", import.meta.url),
          "utf8",
        ),
      );
      await db.query(
        "INSERT INTO files VALUES('Page12','2',NULL); INSERT INTO af_page_backends VALUES('Back12','v1','Page12',1),('Back12','v1','Page12',2)",
      );
      const binding = {
        backendId: "Back12",
        backendVersion: "v1",
        pageId: "Page12",
        pageVersion: 2,
        sourceNamespace: "fixture",
      };
      await assert.rejects(
        registerMigrationViewerBinding(db, { ...binding, pageVersion: 1 }),
        /current viewer/,
      );
      await assert.rejects(
        registerMigrationViewerBinding(db, {
          ...binding,
          backendVersion: "other",
        }),
        /current viewer/,
      );
      await registerMigrationViewerBinding(db, binding);
      await registerMigrationViewerBinding(db, binding);
      assert.equal(
        (await db.query("SELECT count(*)::int n FROM dataset_viewer_bindings"))
          .rows[0].n,
        1,
      );
      await assert.rejects(
        registerMigrationViewerBinding(db, {
          ...binding,
          sourceNamespace: "other",
        }),
        /provenance/,
      );
      await assert.rejects(
        db.query("UPDATE dataset_viewer_bindings SET source_namespace='other'"),
        /immutable/,
      );
      await db.query("UPDATE files SET deleted_at=1");
      await assert.rejects(
        registerMigrationViewerBinding(db, binding),
        /current viewer/,
      );
    } finally {
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await db.end();
    }
  },
);
