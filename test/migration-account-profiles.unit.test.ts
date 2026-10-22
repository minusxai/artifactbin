import test from "node:test";
import assert from "node:assert/strict";
import { migrationHandleCandidate } from "../src/migration/account-profiles.ts";
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
