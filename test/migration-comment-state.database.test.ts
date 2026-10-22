// @requires migration-database
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  PostgresMigrationDestination,
  buildAccountMaps,
} from "../src/migration/postgres.ts";
import { planMigration, applyMigration } from "../src/migration/import.ts";
import type { MigrationManifest } from "../src/migration/contracts.ts";
const { Client } = createRequire(import.meta.url)("pg");
test(
  "imported comment state replays exact historical Values, archives unsupported state and never uses head types",
  { skip: !process.env.MIGRATION_TEST_DATABASE_URL },
  async () => {
    const db = new Client({
      connectionString: process.env.MIGRATION_TEST_DATABASE_URL,
    });
    await db.connect();
    const schema = "comment_replay_" + process.pid;
    const old =
      '<Helmet><Value name="count" type="number" default={1}/></Helmet><p id="n">Old</p>';
    const head =
      '<Helmet><Value name="count" type="string" default="head"/></Helmet><p id="n">Head</p>';
    const manifest: MigrationManifest = {
      schemaVersion: 1,
      sourceNamespace: "replay",
      exportedAt: "epoch",
      tokenOwners: [],
      artifacts: [
        {
          id: "legacy",
          version: 2,
          format: "markup",
          source: head,
          document: null,
          user_id: "u",
          group_id: null,
          token_id: null,
          visibility: "private",
          link_role: "viewer",
          title: "Fixture",
        },
      ],
      tables: {
        users: [{ id: "u", email: "owner@example.test" }],
        artifact_versions: [
          { artifact_id: "legacy", version: 1, format: "markup", source: old },
        ],
        annotations: [
          {
            id: "proven",
            artifact_id: "legacy",
            author_user_id: "u",
            anchor_version: 1,
            anchor_key: "n",
            body: "Saved",
            created_at: "2026-01-01T00:00:00Z",
            view_state: { v: 2, state: { $: { count: 7 } } },
          },
          {
            id: "unsupported",
            artifact_id: "legacy",
            author_user_id: "u",
            anchor_version: 1,
            anchor_key: "n",
            body: "Still readable",
            created_at: "2026-01-01T00:00:01Z",
            view_state: {
              v: 2,
              state: { $: { count: 7 }, "mount:open": true },
            },
          },
        ],
      },
    };
    try {
      const maps = buildAccountMaps(manifest);
      const plan = await planMigration(manifest, {
        maps,
        coreUrl: "/af/v1/core.js",
        convert: ({ source }) => ({
          classification: "functional",
          html: `<html><script type="application/json" data-af="state">${JSON.stringify({ compiledPage: { count: source === old ? 1 : "head" } })}</script><p data-af-id="n">Retained</p></html>`,
          identities: { n: "n" },
          issues: [],
        }),
      });
      assert.equal(plan.pages[0]?.disposition, "ready");
      const destination = new PostgresMigrationDestination(db, {
        schema,
        origin: "http://localhost:8787",
        isolated: true,
        editorManageRestricted: true,
      });
      await destination.prepare({ manifest, maps });
      await applyMigration(plan, destination, { dryRun: false });
      const rows = (
        await db.query(
          `SELECT c.id,c.source_revision,c.app_state_id,c.state_replay,s.state,s.view FROM "${schema}".comments c LEFT JOIN "${schema}".snapshots s ON s.file_id=c.file_id AND s.id=c.app_state_id ORDER BY c.id`,
        )
      ).rows;
      assert.deepEqual(rows, [
        {
          id: "proven",
          source_revision: "1",
          app_state_id: "legacy-proven",
          state_replay: { status: "available", viewport: "document-start" },
          state: { compiledPage: { count: 7 } },
          view: { x: 0, y: 0 },
        },
        {
          id: "unsupported",
          source_revision: "1",
          app_state_id: null,
          state_replay: { status: "unavailable", reason: "unproven-signal" },
          state: null,
          view: null,
        },
      ]);
      const archived = (
        await db.query(
          `SELECT comment_id,raw FROM "${schema}_migration".comment_states ORDER BY comment_id`,
        )
      ).rows;
      assert.deepEqual(
        archived,
        manifest.tables.annotations!.map((c) => ({
          comment_id: c.id,
          raw: c.view_state,
        })),
      );
      assert.equal(
        (await db.query(`SELECT count(*)::int n FROM "${schema}".sources`))
          .rows[0].n,
        2,
      );
    } finally {
      await db.query(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE;DROP SCHEMA IF EXISTS "${schema}_migration" CASCADE`,
      );
      await db.end();
    }
  },
);
