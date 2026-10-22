import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatasetMembersService } from "../src/datasets/members.ts";
const context = {
  backendId: "Back12",
  backendVersion: "version",
  pageId: "Page12",
  subject: null,
};
const snapshot = {
  generation: "a".repeat(64),
  rows: [{ user_id: "original-user", joined_at: "2020-01-01T00:00:00.000Z" }],
};
test("membership reads require fresh authority before and after the snapshot", async () => {
  const seen: unknown[] = [];
  const service = createDatasetMembersService({
    snapshot: async (c) => {
      seen.push(c);
      return snapshot;
    },
  });
  assert.deepEqual(await service.members(context), snapshot);
  assert.deepEqual(seen, [context, context]);
  for (const second of [null, { ...snapshot, generation: "b".repeat(64) }]) {
    let calls = 0;
    await assert.rejects(
      createDatasetMembersService({
        snapshot: async () => (++calls === 1 ? snapshot : second),
      }).members(context),
      /denied|dataset_changed/,
    );
  }
});
test("membership results reject invented timestamps, malformed rows and oversized relations", async () => {
  for (const rows of [
    [{ user_id: "x", joined_at: "" }],
    [{ user_id: "x", joined_at: "not-a-date" }],
    Array.from({ length: 10001 }, () => snapshot.rows[0]!),
  ])
    await assert.rejects(
      createDatasetMembersService({
        snapshot: async () => ({ ...snapshot, rows }),
      }).members(context),
    );
});
