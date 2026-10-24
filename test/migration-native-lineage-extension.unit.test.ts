import test from "node:test";
import assert from "node:assert/strict";
import { extendReviewedNativeLineage } from "../src/migration/native-components/lineage-extension.ts";
import { encodeNativePublicationBytes } from "../src/migration/native-components/pipeline-publication.ts";
import { nativeDigest } from "../src/migration/native-components/selection.ts";
import type { NativeLineageExtensionInput } from "../src/migration/native-components/lineage-extension-contracts.ts";
const encode = (v: unknown) =>
    encodeNativePublicationBytes(Buffer.from(JSON.stringify(v))),
  pin = "a".repeat(64);
function fixture(): NativeLineageExtensionInput {
  const folder = {
    id: "FolderA",
    format: "folder",
    version: 2,
    user_id: "user",
    token_id: "token",
    group_id: null,
    creator_user_id: "user",
    actor_user_id: "user",
    actor_token_id: "token",
    title: "Captured folder",
    description: "Description",
    meta: { color: "blue" },
    source: null,
    document: null,
    document_archived_at: null,
    dataset_policy: null,
    ancestor_ids: [],
    deleted_at: null,
    forked_from: null,
    generation_calls: 0,
    visibility: "private",
    access: "readwrite",
    link_role: "viewer",
    sharing_revision: 1,
    policy_revision: 0,
    edit_id: "edit",
    created_at: "2020-01-01 00:00:00.123456+00",
    updated_at: "2020-01-02 00:00:00.654321+00",
  };
  const witness = {
    id: folder.id,
    format: folder.format,
    version: folder.version,
    user_id: folder.user_id,
    token_id: folder.token_id,
    group_id: null,
    deleted_at: null,
    native_import: null,
  };
  const sourceInventory = {
      snapshot: [{ read_only: "on" }],
      users: [],
      tokens: [],
      artifacts: [witness],
    },
    targetInventory = {
      snapshot: [{ read_only: "on" }],
      users: [],
      tokens: [],
      artifacts: [],
      reservations: [],
    };
  const pageIds = Array.from(
      { length: 393 },
      (_, i) => "P" + String(i).padStart(5, "0"),
    ),
    datasetIds = Array.from(
      { length: 190 },
      (_, i) => "D" + String(i).padStart(5, "0"),
    );
  const targets = {
    actors: { owner: { userId: "target-user" } },
    users: { user: { userId: "target-user", email: null } },
    tokens: { token: { tokenId: "target-token" } },
  };
  const planBody = {
    sourceNamespace: "synthetic",
    sourceInventorySha256: nativeDigest(sourceInventory),
    targetInventorySha256: nativeDigest(targetInventory),
    targets,
    targetIdentitySha256: nativeDigest(targets),
    users: [],
    createUsers: [],
    tokens: [],
    artifactIds: Object.fromEntries(
      [...pageIds, ...datasetIds].map((id) => [id, id]),
    ),
    userCellMappings: [],
    blockers: [],
  };
  const plan = { ...planBody, sha256: nativeDigest(planBody) },
    selectionManifest = encode({ receipts: pageIds.map((id) => ({ id })) });
  const censusBody = {
    mode: "latest-only",
    selectionManifestSha256: selectionManifest.sha256,
    selectedHeads: 393,
    pages: pageIds.map((id) => ({ id })),
    datasets: datasetIds.map((id, i) => {
      const row = {
        id,
        format: "dataset",
        version: 1,
        user_id: "user",
        token_id: "token",
        group_id: null,
        ancestor_ids: i === 0 ? ["FolderA"] : [],
      };
      return { id, version: 1, rowSha256: nativeDigest(row), row };
    }),
  };
  const approvalBody = {
    identityPlanSha256: plan.sha256,
    sourceInventorySha256: plan.sourceInventorySha256,
    targetInventorySha256: plan.targetInventorySha256,
    approvedBy: "reviewed-operator",
    reason: "Preserve referenced ancestor",
    sourceId: folder.id,
    targetId: folder.id,
    sourceRowSha256: nativeDigest(witness),
    targetArtifactCollision: false as const,
    targetReservationCollision: false as const,
    importAncestor: false as const,
  };
  return {
    plan,
    approvedPlanSha256: plan.sha256,
    source: {
      capture: encode({
        snapshot: [{ read_only: "on" }],
        folders: [folder],
        shares: [
          {
            artifact_id: folder.id,
            email: "Viewer@Example.test",
            role: "viewer",
          },
        ],
      }),
      selectionManifest,
      datasetCensus: encode({
        ...censusBody,
        sha256: nativeDigest(censusBody),
      }),
      sourceInventory,
      targetInventory,
    },
    approvals: [{ ...approvalBody, sha256: nativeDigest(approvalBody) }],
  };
}
test("explicit extension produces a new plan while preserving exact page/dataset selections and raw metadata", () => {
  const i = fixture(),
    before = structuredClone(i),
    result = extendReviewedNativeLineage(i);
  assert.deepEqual(i, before);
  assert.notEqual(result.plan.sha256, i.plan.sha256);
  assert.equal(result.plan.artifactIds.FolderA, "FolderA");
  assert.equal(i.plan.artifactIds.FolderA, undefined);
  assert.equal(result.parentIdentityPlanSha256, i.plan.sha256);
  assert.equal(result.selection.pageCount, 393);
  assert.equal(result.selection.datasetCount, 190);
  const folder = result.ancillaryFolders.folders[0]!;
  assert.deepEqual(folder.requiredBy, ["D00000"]);
  assert.equal(folder.row.created_at, "2020-01-01 00:00:00.123456+00");
  assert.equal(folder.row.user_id, "target-user");
  assert.deepEqual(folder.shares, [
    { email: "viewer@example.test", role: "viewer" },
  ]);
  assert.equal(
    (folder.row.meta as any).nativeAncillaryFolder.identityPlanSha256,
    result.plan.sha256,
  );
  assert.equal(
    result.ancillaryFolders.source.capture.sha256,
    i.source.capture.sha256,
  );
});
test("rejects changed approvals, target collisions, unreferenced folders and page scope expansion", () => {
  const i = fixture();
  assert.throws(
    () =>
      extendReviewedNativeLineage({
        ...i,
        approvals: [{ ...i.approvals[0]!, sha256: pin }],
      }),
    /approval/,
  );
  assert.throws(
    () =>
      extendReviewedNativeLineage({
        ...i,
        source: {
          ...i.source,
          targetInventory: {
            ...i.source.targetInventory,
            artifacts: [{ id: "FolderA" }],
          },
        },
      }),
    /inventory/,
  );
  const capture = JSON.parse(
    Buffer.from(i.source.capture.data, "base64").toString(),
  );
  capture.folders[0].id = "Unrelated";
  assert.throws(
    () =>
      extendReviewedNativeLineage({
        ...i,
        source: { ...i.source, capture: encode(capture) },
      }),
    /folder|scope/,
  );
  const manifest = JSON.parse(
    Buffer.from(i.source.selectionManifest.data, "base64").toString(),
  );
  manifest.receipts.push({ id: "ExtraA" });
  assert.throws(
    () =>
      extendReviewedNativeLineage({
        ...i,
        source: { ...i.source, selectionManifest: encode(manifest) },
      }),
    /selection/,
  );
});

import { createHash } from "node:crypto";
import { reattestNativeLineageRemaps } from "../src/migration/native-components/lineage-remaps.ts";
import type {
  NativeLineageUserTable,
  NativeLineageUserRemap,
} from "../src/migration/native-components/lineage-remap-contracts.ts";
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
test("re-attestation verifies unchanged local bytes and user mappings while emitting only new receipts", async () => {
  const i = fixture(),
    source = Buffer.from(JSON.stringify([{ owner: "user", literal: "user" }])),
    target = Buffer.from(
      JSON.stringify([{ owner: "target-user", literal: "user" }]),
    ),
    census = JSON.parse(
      Buffer.from(i.source.datasetCensus.data, "base64").toString(),
    );
  const meta = {
    catalog: {
      kind: "stored",
      tables: [
        {
          schema: "public",
          name: "rows",
          objectKey: "dataset/" + hash(source).slice(0, 32),
          columns: [
            { name: "owner", type: "user" },
            { name: "literal", type: "string" },
          ],
        },
      ],
    },
  };
  census.datasets[0].row.meta = meta;
  census.datasets[0].rowSha256 = nativeDigest(census.datasets[0].row);
  const { sha256, ...censusBody } = census;
  void sha256;
  i.source.datasetCensus = encode({
    ...censusBody,
    sha256: nativeDigest(censusBody),
  });
  const extension = extendReviewedNativeLineage(i),
    table: NativeLineageUserTable = {
      sourceId: "D00000",
      version: 1,
      schema: "public",
      table: "rows",
      sourceMetaSha256: nativeDigest(meta),
      sourceObjectKey: "dataset/" + hash(source).slice(0, 32),
      userColumns: ["owner"],
    };
  const receiptBody = {
      ...table,
      sourceSha256: hash(source),
      sourceBytes: source.length,
      identityPlanSha256: i.plan.sha256,
      usersSha256: nativeDigest({ user: "target-user" }),
      targetKey: "dataset/" + hash(target).slice(0, 32),
      targetSha256: hash(target),
      targetBytes: target.length,
      changedCells: 1,
    },
    receipt: NativeLineageUserRemap = {
      ...receiptBody,
      receiptSha256: nativeDigest(receiptBody),
    };
  const input = {
      parentPlan: i.plan,
      extension,
      receipts: [
        { receipt, sourcePath: "source-object", targetPath: "target-object" },
      ],
    },
    seen: string[] = [];
  const host = {
    read: async (path: string) => {
      seen.push(path);
      return path === "source-object" ? source : target;
    },
    tables: () => [table],
    derive: (
      _table: NativeLineageUserTable,
      bytes: Uint8Array,
      users: Readonly<Record<string, string>>,
      planSha: string,
    ) => {
      assert.deepEqual(bytes, source);
      assert.deepEqual(users, { user: "target-user" });
      const body = { ...receiptBody, identityPlanSha256: planSha };
      return {
        receipt: { ...body, receiptSha256: nativeDigest(body) },
        bytes: target,
      };
    },
  };
  const result = await reattestNativeLineageRemaps(input, host);
  assert.deepEqual(seen.sort(), ["source-object", "target-object"]);
  assert.equal(
    result.receipts[0]?.receipt.identityPlanSha256,
    extension.plan.sha256,
  );
  assert.equal(result.receipts[0]?.receipt.targetSha256, receipt.targetSha256);
  assert.equal(input.receipts[0]?.receipt.identityPlanSha256, i.plan.sha256);
  await assert.rejects(
    reattestNativeLineageRemaps(input, {
      ...host,
      read: async (path) =>
        path === "source-object" ? source : Buffer.from("changed"),
    }),
    /object_bytes_changed/,
  );
  await assert.rejects(
    reattestNativeLineageRemaps(
      {
        ...input,
        receipts: [
          { ...input.receipts[0]!, receipt: { ...receipt, usersSha256: pin } },
        ],
      },
      host,
    ),
    /receipt_changed/,
  );
});

test("reviewed booleans never override actual target inventory collisions", () => {
  const i = fixture();
  i.source.targetInventory = {
    ...i.source.targetInventory,
    artifacts: [{ id: "FolderA" }],
  };
  const { sha256: oldPlanSha, ...oldBody } = i.plan;
  void oldPlanSha;
  const planBody = {
    ...oldBody,
    targetInventorySha256: nativeDigest(i.source.targetInventory),
  };
  i.plan = { ...planBody, sha256: nativeDigest(planBody) };
  i.approvedPlanSha256 = i.plan.sha256;
  const { sha256: oldApprovalSha, ...approvalBody } = i.approvals[0]!;
  void oldApprovalSha;
  const changed = {
    ...approvalBody,
    identityPlanSha256: i.plan.sha256,
    targetInventorySha256: i.plan.targetInventorySha256,
  };
  i.approvals = [{ ...changed, sha256: nativeDigest(changed) }];
  assert.throws(() => extendReviewedNativeLineage(i), /target_collision/);
});
