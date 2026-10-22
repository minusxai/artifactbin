import test from "node:test";
import assert from "node:assert/strict";
import { planGroupHandles } from "../src/migration/group-handles.ts";
import type { GroupHandleBaseProof } from "../src/migration/group-handles-contracts.ts";
const base: GroupHandleBaseProof = {
  kind: "verified-base-import",
  sourceNamespace: "fixture",
  archiveManifestSha256: "a".repeat(64),
  reportSha256: "b".repeat(64),
  datasetReportSha256: "e".repeat(64),
  visualizationReportSha256: "f".repeat(64),
};
const candidate = {
  legacyGroupId: "old-group",
  actor: "group:" + "c".repeat(64),
  sourceHandle: "fixture-team",
  sourceDeleted: false,
  expectedHandle: null,
} as const;
test("group handle plans preserve exact source spelling and bind source, mapping and verified report", () => {
  const plan = planGroupHandles(base, [candidate]);
  assert.deepEqual(plan.candidates, [candidate]);
  assert.equal(plan.sha256.length, 64);
  assert.notEqual(
    planGroupHandles({ ...base, reportSha256: "d".repeat(64) }, [candidate])
      .sha256,
    plan.sha256,
  );
  assert.notEqual(
    planGroupHandles(base, [{ ...candidate, sourceHandle: "another-team" }])
      .sha256,
    plan.sha256,
  );
});
test("invalid source handles, duplicate identity/mapping and shared account/group handle collisions are refused", () => {
  for (const sourceHandle of [
    " MixedCase ",
    "api",
    "bad--handle",
    "",
    "x".repeat(33),
  ])
    assert.throws(() =>
      planGroupHandles(base, [{ ...candidate, sourceHandle }]),
    );
  assert.throws(() => planGroupHandles(base, [candidate, candidate]));
  assert.throws(() =>
    planGroupHandles(base, [
      candidate,
      {
        ...candidate,
        legacyGroupId: "other",
        actor: "group:" + "d".repeat(64),
      },
    ]),
  );
  assert.throws(() =>
    planGroupHandles(base, [{ ...candidate, actor: "person@example.test" }]),
  );
  assert.throws(() =>
    planGroupHandles({ ...base, reportSha256: "not-a-digest" }, [candidate]),
  );
  assert.throws(() => planGroupHandles(base, []));
  assert.throws(() =>
    planGroupHandles({ ...base, datasetReportSha256: "" }, [candidate]),
  );
  assert.throws(() =>
    planGroupHandles({ ...base, visualizationReportSha256: "" }, [candidate]),
  );
});
test("candidate order does not change the approved plan identity", () => {
  const other = {
    ...candidate,
    legacyGroupId: "second",
    actor: "group:" + "d".repeat(64),
    sourceHandle: "second-team",
  };
  assert.deepEqual(
    planGroupHandles(base, [candidate, other]),
    planGroupHandles(base, [other, candidate]),
  );
});
