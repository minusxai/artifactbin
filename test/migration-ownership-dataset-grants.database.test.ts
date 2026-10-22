import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./postgres.js";
import {
  persistMigrationOwnershipDatasetGrantAudit as persist,
  verifyMigrationOwnershipDatasetGrantAudit as verify,
} from "../src/migration/ownership-dataset-grant-audit.ts";
import type { MigrationOwnershipDatasetGrantAudit } from "../src/migration/ownership-dataset-grants-contracts.ts";
test("dataset editor grant audit commits atomically and refuses changed or missing retry evidence", async () => {
  const env = await testDatabase();
  const db = await env.pool.connect();
  const archive = '"' + env.schema + '"';
  const audit = {
    sourceNamespace: "fixture",
    scopeSha256: "a".repeat(64),
    datasetLegacyId: "data01",
    sourceSha256: "b".repeat(64),
    originalSource: { id: "data01" },
    originalResource: { legacyId: "data01" },
    assignedEditor: "owner@example.test",
    operations: [{ pageLegacyId: "page01", operationName: "save" }],
  } as unknown as MigrationOwnershipDatasetGrantAudit;
  try {
    await db.query("BEGIN");
    await persist(db, archive, "fixture", [audit], false);
    await db.query("ROLLBACK");
    assert.equal(
      (
        await db.query("SELECT to_regclass($1) AS name", [
          env.schema + ".ownership_dataset_grants",
        ])
      ).rows[0].name,
      null,
    );
    await db.query("BEGIN");
    await persist(db, archive, "fixture", [audit], false);
    await db.query("COMMIT");
    await db.query("BEGIN");
    await persist(db, archive, "fixture", [audit], true);
    await db.query("COMMIT");
    assert.equal(await verify(db, archive, "fixture", [audit]), 1);
    await db.query("BEGIN");
    await assert.rejects(
      persist(
        db,
        archive,
        "fixture",
        [{ ...audit, assignedEditor: "other@example.test" }],
        true,
      ),
      /differs/,
    );
    await db.query("ROLLBACK");
    await db.query(`DELETE FROM ${archive}.ownership_dataset_grants`);
    await db.query("BEGIN");
    await assert.rejects(
      persist(db, archive, "fixture", [audit], true),
      /removed/,
    );
    await db.query("ROLLBACK");
    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int AS count FROM ${archive}.ownership_dataset_grants`,
        )
      ).rows[0].count,
      0,
    );
    await assert.rejects(verify(db, archive, "fixture", [audit]), /differs/);
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await env.cleanup();
  }
});
