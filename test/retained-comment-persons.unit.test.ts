import test from "node:test";
import assert from "node:assert/strict";
import { planRetainedCommentPersons } from "../src/comments/retained-persons.ts";
const evidence = {
  sourceNamespace: "source",
  legacyPageId: "original",
  pageId: "Abc123",
  commentId: "note",
  body: "[@saved](/people/user1)",
  archiveSha256: "a".repeat(64),
  receiptSha256: "b".repeat(64),
};
test("retained person plan binds exact saved body and receipt without rewriting author text", () => {
  const input = structuredClone(evidence);
  const plan = planRetainedCommentPersons([input]);
  assert.deepEqual(input, evidence);
  assert.deepEqual(plan.entries[0]?.legacyUserIds, ["user1"]);
  assert.match(plan.entries[0]!.bodySha256, /^[a-f0-9]{64}$/);
  assert.equal("body" in plan.entries[0]!, false);
  assert.notEqual(
    plan.entries[0]?.bodySha256,
    planRetainedCommentPersons([
      { ...evidence, body: evidence.body + " edited" },
    ]).entries[0]?.bodySha256,
  );
});
test("retained plan refuses ambiguous comment scope and malformed provenance", () => {
  assert.throws(() =>
    planRetainedCommentPersons([
      evidence,
      { ...evidence, sourceNamespace: "other" },
    ]),
  );
  assert.throws(() =>
    planRetainedCommentPersons([{ ...evidence, archiveSha256: "bad" }]),
  );
  assert.throws(() =>
    planRetainedCommentPersons([{ ...evidence, pageId: "bad/path" }]),
  );
});
