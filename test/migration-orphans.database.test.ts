import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { planMigrationIdentities } from "../src/migration/identities.ts";
import { PostgresMigrationDestination } from "../src/migration/postgres.ts";
import { planMigration, applyMigration } from "../src/migration/import.ts";
import type { MigrationManifest } from "../src/migration/contracts.ts";
const { Client } = createRequire(import.meta.url)("pg");
test(
  "orphan import saves no credentials and refuses a claimed preexisting principal",
  { skip: !process.env.MIGRATION_TEST_DATABASE_URL },
  async () => {
    const db = new Client({
      connectionString: process.env.MIGRATION_TEST_DATABASE_URL,
    });
    await db.connect();
    const schema = "migration_orphan_" + process.pid;
    try {
      const manifest: MigrationManifest = {
        schemaVersion: 1,
        sourceNamespace: "fixture",
        exportedAt: "",
        tables: { users: [] },
        tokenOwners: [],
        artifacts: [
          {
            id: "abc123",
            format: "markup",
            version: 1,
            user_id: null,
            group_id: null,
            token_id: "",
            source: "<p>Retained</p>",
            document: null,
            visibility: "public",
            link_role: "viewer",
          },
        ],
      };
      const maps = planMigrationIdentities(manifest).maps;
      const plan = await planMigration(manifest, {
        maps,
        coreUrl: "/af/v1/core.js",
        convert: () => ({
          classification: "renderable",
          html: '<html><head><script data-af="core" src="/af/v1/core.js"></script></head><body><p>Retained</p></body></html>',
          identities: {},
          issues: [],
        }),
      });
      const destination = new PostgresMigrationDestination(
        db,
        {
          schema,
          origin: "https://example.test",
          isolated: true,
          editorManageRestricted: true,
        },
        maps,
      );
      await destination.prepare({ manifest, maps: plan.maps });
      assert.equal(
        (await applyMigration(plan, destination, { dryRun: false })).created,
        1,
      );
      const actor = plan.maps.orphans!.abc123;
      assert.deepEqual(
        (
          await db.query(
            `SELECT salt,password,handle,principal_kind FROM "${schema}".accounts WHERE actor=$1`,
            [actor],
          )
        ).rows[0],
        { salt: null, password: null, handle: null, principal_kind: "user" },
      );
      assert.equal(
        (await db.query(`SELECT count(*)::int AS n FROM "${schema}".sessions`))
          .rows[0].n,
        0,
      );
      const fake = structuredClone(plan.pages[0]!);
      fake.original.token_id = "missing";
      assert.equal(destination.supportsExactAccess(fake), false);
      // Simulate a conflicting account created before the archival-principal guard existed.
      await db.query(
        `ALTER TABLE "${schema}".accounts DISABLE TRIGGER group_principal_guard`,
      );
      await db.query(
        `UPDATE "${schema}".accounts SET handle='claimed' WHERE actor=$1`,
        [actor],
      );
      await db.query(
        `ALTER TABLE "${schema}".accounts ENABLE TRIGGER group_principal_guard`,
      );
      await assert.rejects(
        destination.prepare({ manifest, maps: plan.maps }),
        /Orphan principal conflicts/,
      );
    } finally {
      await db.query(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE;DROP SCHEMA IF EXISTS "${schema}_migration" CASCADE`,
      );
      await db.end();
    }
  },
);
