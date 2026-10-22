import test from "node:test";
import assert from "node:assert/strict";
import {
  migrationTestRequirements,
  requiredMigrationInputs,
} from "../scripts/testing/migration-requirements.ts";
import { classifyTests, selectTests } from "../scripts/testing/inventory.ts";
test("required migration selection follows explicit capability flags, including new files", () => {
  const tests = classifyTests([
    "test/new.browser.test.ts",
    "test/plain.unit.test.ts",
  ]);
  tests[0]!.requirements.migration = migrationTestRequirements(
    "// @requires archived-compiler",
  );
  assert.deepEqual(
    selectTests(tests, "required-migration").map((t) => t.file),
    ["test/new.browser.test.ts"],
  );
  assert.throws(
    () =>
      migrationTestRequirements(
        "const root=process" + ".env.PAGEGI_ARCHIVED_COMPILER_ROOT;",
      ),
    /Declare/,
  );
  assert.throws(
    () => migrationTestRequirements("// @requires migration-databse"),
    /Unknown/,
  );
});
test("required migration preflight refuses absent or broken inputs without disclosing database URLs", () => {
  const env = {
    PAGEGI_ARCHIVED_COMPILER_ROOT: "/frozen",
    MIGRATION_TEST_DATABASE_URL: "postgres://private:secret@example.test/db",
  };
  assert.throws(
    () => requiredMigrationInputs({}, () => true),
    /PAGEGI_ARCHIVED_COMPILER_ROOT/,
  );
  assert.throws(
    () =>
      requiredMigrationInputs(
        { PAGEGI_ARCHIVED_COMPILER_ROOT: "/frozen" },
        () => true,
      ),
    /MIGRATION_TEST_DATABASE_URL/,
  );
  assert.throws(() => requiredMigrationInputs(env, () => false), /Incomplete/);
  assert.deepEqual(
    requiredMigrationInputs(env, () => true),
    { archivedRoot: "/frozen", databaseUrl: env.MIGRATION_TEST_DATABASE_URL },
  );
});
