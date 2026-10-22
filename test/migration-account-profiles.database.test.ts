import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { projectMigrationAccountProfiles } from "../src/migration/account-profiles.ts";
const { Client } = createRequire(import.meta.url)("pg");
test(
  "account profile migration preserves edits and reports handle collisions without transferring ownership",
  { skip: !process.env.MIGRATION_TEST_DATABASE_URL },
  async () => {
    const db = new Client({
      connectionString: process.env.MIGRATION_TEST_DATABASE_URL,
    });
    await db.connect();
    const schema = "migration_profiles_" + process.pid;
    try {
      await db.query(
        `CREATE SCHEMA ${schema}; SET search_path TO ${schema}; CREATE TABLE accounts(actor text PRIMARY KEY,name text,handle text UNIQUE);`,
      );
      const nonlogin = "legacy-user:" + "a".repeat(64);
      await db.query(
        "INSERT INTO accounts VALUES('one',NULL,NULL),('two',NULL,NULL),('three',NULL,NULL),('edited','Current label','current-handle'),($1,NULL,NULL)",
        [nonlogin],
      );
      const users = [
        { id: "a", name: "One", username: "  Legacy-Name " },
        { id: "b", name: "Two", username: "legacy-name" },
        { id: "c", name: "Three", username: "admin" },
        { id: "d", name: "Old label", username: "old-handle" },
        { id: "e", name: "Historical", username: "historical" },
      ];
      const summary = await projectMigrationAccountProfiles(db, users, {
        a: "one",
        b: "two",
        c: "three",
        d: "edited",
        e: nonlogin,
      });
      assert.deepEqual(summary, {
        namesFilled: 4,
        namesPreserved: 1,
        namesUnavailable: 0,
        namesClearedSinceImport: 0,
        handlesFilled: 1,
        handlesPreserved: 1,
        handlesMissing: 0,
        handlesInvalid: 1,
        handlesColliding: 1,
        handlesNonlogin: 1,
        handlesAbsentSinceImport: 0,
      });
      assert.deepEqual(
        (
          await db.query(
            "SELECT actor,name,handle FROM accounts ORDER BY actor",
          )
        ).rows,
        [
          { actor: nonlogin, name: "Historical", handle: null },
          { actor: "edited", name: "Current label", handle: "current-handle" },
          { actor: "one", name: "One", handle: "legacy-name" },
          { actor: "three", name: "Three", handle: null },
          { actor: "two", name: "Two", handle: null },
        ].sort((a, b) => a.actor.localeCompare(b.actor)),
      );
      await db.query(
        "UPDATE accounts SET name='Edited after import',handle='new-name' WHERE actor='one'",
      );
      await projectMigrationAccountProfiles(db, users, {
        a: "one",
        b: "two",
        c: "three",
        d: "edited",
        e: nonlogin,
      });
      assert.deepEqual(
        (await db.query("SELECT name,handle FROM accounts WHERE actor='one'"))
          .rows[0],
        { name: "Edited after import", handle: "new-name" },
      );
    } finally {
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await db.end();
    }
  },
);
