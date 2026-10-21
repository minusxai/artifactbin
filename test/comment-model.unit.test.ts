import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptLoadedComment,
  editLoadedComment,
} from "../src/comment-model.ts";
import type { CommentAcceptanceContext } from "../src/comment-model-contracts.ts";
const draft = {
  id: "c",
  nodeId: null,
  quote: "",
  body: "hello",
  sourceRevision: "r",
  parentId: null,
};
const options = { digest: (s: string) => s, now: 0 };
const loaded: CommentAcceptanceContext = {
  sourceExists: true,
  parentExists: false,
  existing: null,
  sequence: 8,
};
test("acceptance checks explicit source and parent existence", () => {
  assert.throws(
    () =>
      acceptLoadedComment(
        { ...loaded, sourceExists: false },
        "actor",
        draft,
        null,
        options,
      ),
    /Publish this source/,
  );
  assert.throws(
    () =>
      acceptLoadedComment(
        loaded,
        "actor",
        { ...draft, parentId: "missing" },
        null,
        options,
      ),
    /Reply parent/,
  );
  assert.equal(
    acceptLoadedComment(loaded, "actor", draft, null, options).comment.sequence,
    9,
  );
});
test("duplicate acceptance is idempotent and preserves author and sequence", () => {
  const first = acceptLoadedComment(loaded, "actor", draft, null, options);
  const replay = acceptLoadedComment(
    { ...loaded, existing: first.comment, sequence: 100 },
    "other",
    draft,
    null,
    options,
  );
  assert.equal(replay.created, false);
  assert.deepEqual(replay.comment, first.comment);
  assert.equal(replay.snapshot, null);
  assert.throws(
    () =>
      acceptLoadedComment(
        { ...loaded, existing: first.comment },
        "actor",
        { ...draft, body: "changed" },
        null,
        options,
      ),
    /ID conflict/,
  );
});
test("snapshot validity is enforced without loading source content", () => {
  const snapshot = {
    sourceRevision: "r",
    schema: 0,
    state: {},
    view: { x: 0, y: 0 },
  };
  assert.ok(
    acceptLoadedComment(loaded, "actor", draft, snapshot, options).snapshot,
  );
  assert.throws(
    () =>
      acceptLoadedComment(
        loaded,
        "actor",
        draft,
        { ...snapshot, sourceRevision: "other" },
        options,
      ),
    /Snapshot source/,
  );
  assert.throws(
    () =>
      acceptLoadedComment(
        loaded,
        "actor",
        draft,
        { ...snapshot, schema: -1 },
        options,
      ),
    /Invalid snapshot/,
  );
});
test("editing checks actor permission before revision and accepts owner", () => {
  const { comment } = acceptLoadedComment(
    loaded,
    "actor",
    draft,
    null,
    options,
  );
  assert.throws(
    () => editLoadedComment(comment, "other", false, 1, { body: "x" }),
    /Only the author/,
  );
  assert.throws(
    () => editLoadedComment(comment, "actor", false, 0, { body: "x" }),
    /Comment changed/,
  );
  assert.equal(
    editLoadedComment(comment, "owner", true, 1, { body: "x" }).revision,
    2,
  );
});
