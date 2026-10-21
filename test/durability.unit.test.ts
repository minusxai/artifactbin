import { test } from "node:test";
import assert from "node:assert/strict";
import {
  needsUnloadWarning,
  recoverView,
  recoveryKey,
} from "../src/durability.ts";
import type { DurabilityState, Snapshot } from "../src/contracts.js";
const clean: DurabilityState = {
  hosted: true,
  fileDirty: true,
  recoveryFailed: false,
  pendingComments: 0,
  drafts: {},
};
const snapshot: Snapshot = {
  schema: 1,
  sourceRevision: "v1",
  state: { count: 3 },
  view: { x: 0, y: 10 },
};
test("hosted cached updates and recovered own view are durable", () => {
  assert.equal(needsUnloadWarning(clean), false);
  assert.equal(needsUnloadWarning({ ...clean, fileDirty: false }), false);
});
test("pending remote comments and unsent drafts protect refresh even in saved context", () => {
  assert.equal(needsUnloadWarning({ ...clean, pendingComments: 1 }), true);
  assert.equal(
    needsUnloadWarning({ ...clean, drafts: { thread: "unsent" } }),
    true,
  );
  assert.equal(
    needsUnloadWarning({ ...clean, drafts: { thread: "  " } }),
    false,
  );
});
test("local file changes and preview saves remain protected until written", () => {
  assert.equal(needsUnloadWarning({ ...clean, hosted: false }), true);
  assert.equal(
    needsUnloadWarning({ ...clean, hosted: false, fileDirty: false }),
    false,
  );
  assert.equal(needsUnloadWarning({ ...clean, recoveryFailed: true }), true);
});
test("recovery is scoped to file, user and source revision and rejects corrupt state", () => {
  const serialized = JSON.stringify({
    format: 1,
    sourceRevision: "v1",
    snapshot,
  });
  assert.deepEqual(recoverView(serialized, "v1"), snapshot);
  assert.equal(recoverView(serialized, "v2"), undefined);
  assert.equal(recoverView("{", "v1"), undefined);
  assert.equal(
    recoverView(
      '{"format":1,"sourceRevision":"v1","snapshot":{"schema":1,"sourceRevision":"v1","state":{"count":1e999},"view":{"x":0,"y":0}}}',
      "v1",
    ),
    undefined,
  );
  assert.equal(
    recoverView(
      JSON.stringify({
        format: 1,
        sourceRevision: "v1",
        snapshot: { ...snapshot, view: null },
      }),
      "v1",
    ),
    undefined,
  );
  assert.equal(
    recoverView(
      JSON.stringify({
        format: 1,
        sourceRevision: "v1",
        snapshot: { ...snapshot, sourceRevision: "v2" },
      }),
      "v1",
    ),
    undefined,
  );
  assert.notEqual(
    recoveryKey("origin", "file", "alice"),
    recoveryKey("origin", "file", "bob"),
  );
  assert.notEqual(
    recoveryKey("origin", "file", "alice"),
    recoveryKey("origin", "other", "alice"),
  );
  assert.notEqual(
    recoveryKey("origin", "file", "alice"),
    recoveryKey("other", "file", "alice"),
  );
});
