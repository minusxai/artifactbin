import test from "node:test";
import assert from "node:assert/strict";
import { migrationCompilerIdentity } from "../src/migration/compiler-identity.ts";
import { validateMigrationSourceAdmission } from "../src/migration/source-admission-policy.ts";
test("offline prototype source admission is explicit and restricted to functional migration", () => {
  assert.equal(
    validateMigrationSourceAdmission({
      conversionStrategy: "archived-functional",
    }),
    "strict",
  );
  assert.equal(
    validateMigrationSourceAdmission({
      conversionStrategy: "archived-functional",
      sourceAdmission: "offline-prototype",
    }),
    "offline-prototype",
  );
  for (const conversionStrategy of ["strict", "archived-static"] as const)
    assert.throws(
      () =>
        validateMigrationSourceAdmission({
          conversionStrategy,
          sourceAdmission: "offline-prototype",
        }),
      /archived-functional/,
    );
  assert.throws(
    () =>
      validateMigrationSourceAdmission({
        conversionStrategy: "archived-functional",
        sourceAdmission: "unexpected" as never,
      }),
    /source admission/,
  );
});
test("offline admission policy cannot reuse the strict conversion cache identity", async () => {
  const identify = async () => "frozen-compiler";
  const strict = await migrationCompilerIdentity({}, identify);
  const prototype = await migrationCompilerIdentity(
    { sourceAdmission: "offline-prototype" },
    identify,
  );
  assert.equal(strict, "frozen-compiler");
  assert.notEqual(prototype, strict);
  assert.equal(
    prototype,
    await migrationCompilerIdentity(
      { sourceAdmission: "offline-prototype" },
      identify,
    ),
  );
});
