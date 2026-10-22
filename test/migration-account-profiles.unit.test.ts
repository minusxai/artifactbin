import test from "node:test";
import assert from "node:assert/strict";
import {
  migrationHandleCandidate,
  migrationPublicDisplayName,
} from "../src/migration/account-profiles.ts";
test("migration handles use the ordinary runtime normalization and reserved word boundary", () => {
  assert.deepEqual(migrationHandleCandidate("  Mixed-Case  "), {
    handle: "mixed-case",
    status: "valid",
  });
  for (const value of ["admin", "pagegi", "a--b", "x", "a_b"])
    assert.deepEqual(migrationHandleCandidate(value), {
      handle: null,
      status: "invalid",
    });
  assert.deepEqual(migrationHandleCandidate(null), {
    handle: null,
    status: "missing",
  });
  assert.deepEqual(migrationHandleCandidate(""), {
    handle: null,
    status: "missing",
  });
});

test("public label fallback preserves the archived public username and never an email", () => {
  assert.equal(
    migrationPublicDisplayName({
      name: null,
      username: "public_name_ab12",
      email: "secret@example.test",
    }),
    "public_name_ab12",
  );
  assert.equal(
    migrationPublicDisplayName({ name: "Display", username: "public_name" }),
    "Display",
  );
  assert.equal(
    migrationPublicDisplayName({
      name: null,
      username: null,
      email: "secret@example.test",
    }),
    null,
  );
  assert.equal(
    migrationPublicDisplayName({ username: "secret@example.test" }),
    null,
  );
});
