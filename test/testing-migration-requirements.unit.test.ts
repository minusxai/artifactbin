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
test("discovery errors identify the exact file needing a requirement declaration", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { discoverTests } = await import("../scripts/testing/inventory.ts");
  const root = await mkdtemp(join(tmpdir(), "test-requirements-"));
  try {
    await mkdir(join(root, "test"));
    await writeFile(
      join(root, "test", "new.browser.test.ts"),
      "const root=process" + ".env.PAGEGI_ARCHIVED_COMPILER_ROOT;",
    );
    assert.throws(
      () => discoverTests(root),
      /test\/new\.browser\.test\.ts: Declare.*archived-compiler/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("registered query compiler verification belongs to the required archived compiler gate", async () => {
  const { discoverTests } = await import("../scripts/testing/inventory.ts");
  const required = selectTests(discoverTests(), "required-migration");
  const query = required.filter(
    (t) => t.file === "test/migration-query-compiler.database.test.ts",
  );
  assert.equal(query.length, 1);
  assert.deepEqual(query[0]!.requirements.migration, ["archived-compiler"]);
});
test("retired compiler environment aliases cannot hide a skipped migration test from discovery", () => {
  assert.throws(
    () =>
      migrationTestRequirements(
        "const root=process" + ".env.MIGRATION_LEGACY_ROOT;",
      ),
    /PAGEGI_ARCHIVED_COMPILER_ROOT/,
  );
});
