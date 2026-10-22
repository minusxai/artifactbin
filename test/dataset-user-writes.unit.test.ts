import test from "node:test";
import assert from "node:assert/strict";
import { validateUserAssignments } from "../src/datasets/mutation/user-writes.ts";
const facts = {
  callerUserId: "me",
  knownUserIds: ["me", "other", "constructor"],
  members: new Map([["ref:page", new Set(["me"])]]),
};
test("actual user assignments require known IDs, self constraints and current document membership", () => {
  const col = {
    name: "owner",
    type: "user" as const,
    constraints: { self: true, memberOf: ["ref:page"] },
  };
  validateUserAssignments([col], [{ owner: "me" }, { owner: null }], facts);
  for (const value of ["other", "unknown", 123, undefined])
    assert.throws(() =>
      validateUserAssignments([col], [{ owner: value }], facts),
    );
  assert.throws(() =>
    validateUserAssignments(
      [{ ...col, constraints: { memberOf: ["current"] } }],
      [{ owner: "me" }],
      facts,
    ),
  );
  assert.throws(() =>
    validateUserAssignments(
      [{ ...col, constraints: { memberOf: [] } }],
      [{ owner: "me" }],
      facts,
    ),
  );
  validateUserAssignments(
    [{ name: "owner", type: "user" }],
    [{ owner: "constructor" }],
    facts,
  );
  validateUserAssignments([col], [{}], facts); // An unchanged user field is not a new assignment.
});
