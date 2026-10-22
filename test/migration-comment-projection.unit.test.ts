import test from "node:test";
import assert from "node:assert/strict";
import { projectMigrationCommentContext } from "../src/migration/comment-projection.ts";
import type { PlannedRevision } from "../src/migration/contracts.ts";
const revisions: PlannedRevision[] = [
  {
    version: 1,
    original: {},
    conversion: {
      classification: "renderable",
      html: "",
      issues: [],
      identities: { anchor: "historical-target" },
    },
  },
  {
    version: 2,
    original: {},
    conversion: {
      classification: "renderable",
      html: "",
      issues: [],
      identities: { anchor: "head-target", orphan: "head-only-target" },
    },
  },
];
test("thread anchor uses its exact recorded revision and preserves orphan IDs without head remapping", () => {
  assert.deepEqual(
    projectMigrationCommentContext({
      root: { anchor_version: 1, anchor_key: "anchor" },
      revisions,
    }),
    { sourceRevision: "1", nodeId: "historical-target", contextStatus: null },
  );
  assert.deepEqual(
    projectMigrationCommentContext({
      root: { anchor_version: 1, anchor_key: "orphan" },
      revisions,
    }),
    { sourceRevision: "1", nodeId: "orphan", contextStatus: null },
  );
});
test("missing and unrecorded source contexts never attach to a current head", () => {
  for (const [anchor_version, originalRevision] of [
    [99, "99"],
    [null, "unknown"],
    [undefined, "unknown"],
  ] as const) {
    assert.deepEqual(
      projectMigrationCommentContext({
        root: { anchor_version, anchor_key: "anchor" },
        revisions,
      }),
      {
        sourceRevision: null,
        nodeId: null,
        contextStatus: {
          status: "unavailable",
          originalRevision,
          reason: "not-retained",
        },
      },
    );
  }
});
