import test from "node:test";
import assert from "node:assert/strict";
import { requireMigrationInventoryEquality } from "../src/migration/verification-values.ts";
import { verifyMigrationAuthority } from "../src/migration/authority-verification.ts";

test("inventory equality accepts database collation order without changing inputs", () => {
  const actual = ["a00001", "Z00001"], expected = ["Z00001", "a00001"];
  requireMigrationInventoryEquality({actual, expected, label: "page IDs"});
  assert.deepEqual(actual, ["a00001", "Z00001"]);
  assert.deepEqual(expected, ["Z00001", "a00001"]);
});
test("inventory equality preserves exact membership, multiplicity and case", () => {
  for (const actual of [["a"], ["a", "b", "c"], ["a", "a"], ["A", "b"]])
    assert.throws(() => requireMigrationInventoryEquality({actual, expected: ["a", "b"], label: "inventory"}), /inventory/);
  requireMigrationInventoryEquality({actual: [], expected: [], label: "empty"});
});
test("unordered inventory comparison preserves every row field", () => {
  const expected = [{actor: "Z@example.test", role: "viewer"}, {actor: "a@example.test", role: "editor"}];
  requireMigrationInventoryEquality({actual: [...expected].reverse(), expected, label: "members"});
  assert.throws(() => requireMigrationInventoryEquality({actual: [{...expected[0]!, role: "editor"}, expected[1]!], expected, label: "members"}), /members/);
});
test("authority verifier accepts complete account identities returned in database order", async () => {
  const actors = ["Z@example.test", "a@example.test"];
  const count = await verifyMigrationAuthority({query: async () => ({rows: [...actors].reverse().map(actor => ({actor, salt: null, password: null, handle: null}))})}, "fixture", {schemaVersion: 1, sourceNamespace: "fixture", exportedAt: "2026-01-01T00:00:00Z", tables: {}, artifacts: [], tokenOwners: []}, {users: {first: actors[0]!, second: actors[1]!}, tokens: {}, groups: {}, pages: {}});
  assert.equal(count, 2);
});
