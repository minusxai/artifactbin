import test from "node:test";
import assert from "node:assert/strict";
import { planNativeV3Identities } from "./v3-identity-projection.ts";
import type { NativeV3IdentityInput } from "./v3-identity-contracts.ts";
const user = (id: string, email: string | null, kind = "account") => ({
  id,
  email,
  kind,
  created_at: "2020-01-01T00:00:00.000Z",
});
function fixture(): NativeV3IdentityInput {
  return {
    sourceNamespace: "synthetic",
    sourceInventorySha256: "a".repeat(64),
    targetInventorySha256: "b".repeat(64),
    targetCollectedAt: "2026-01-01T00:00:00Z",
    sourceUsers: [
      user("source-owner", "Owner@Example.test"),
      user("source-other", "other@example.test"),
      user("source-guest", null, "guest"),
    ],
    sourceTokens: [{ id: "source-token", user_id: "source-owner" }],
    targetUsers: [user("existing-owner", "owner@example.test")],
    targetTokens: [],
    targetArtifacts: [],
    targetReservations: [],
    requiredUserIds: ["source-other", "source-guest"],
    requiredTokenIds: ["source-token"],
    artifactIds: ["SourcePage", "SourceDataset"],
    legacyMaps: {
      pages: { SourcePage: "SourcePage", SourceDataset: "SourceDataset" },
      users: {
        "source-owner": "owner@example.test",
        "source-other": "other@example.test",
        "source-guest": "legacy-user:" + "c".repeat(64),
      },
      tokens: { "source-token": "owner@example.test" },
      groups: {},
    },
  };
}
test("reuses only exact verified account email and otherwise preserves original IDs, with disabled provenance tokens", () => {
  const input = fixture(),
    plan = planNativeV3Identities(input);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.targets.users["source-owner"]!.userId, "existing-owner");
  assert.equal(plan.targets.users["source-other"]!.userId, "source-other");
  assert.equal(plan.targets.users["source-guest"]!.userId, "source-guest");
  assert.deepEqual(plan.targets.tokens["source-token"], {
    tokenId: "source-token",
  });
  assert.equal(plan.tokens[0]!.userId, "existing-owner");
  assert.equal(plan.tokens[0]!.action, "create-disabled-provenance");
  assert.equal(plan.createUsers.length, 2);
  assert.equal(
    plan.createUsers.find((u) => u.id === "source-guest")!.email,
    null,
  );
  assert.equal(
    plan.createUsers.find((u) => u.id === "source-guest")!.kind,
    "guest",
  );
  assert.deepEqual(plan.artifactIds, {
    SourceDataset: "SourceDataset",
    SourcePage: "SourcePage",
  });
  assert.equal(plan.userCellMappings.length, 1);
  assert.equal(plan.userCellMappings[0]!.reason, "verified-email");
  assert.equal(planNativeV3Identities(input).sha256, plan.sha256);
});
test("rejects unrelated user/token/artifact/reservation collisions and never allocates replacement IDs", () => {
  const input = fixture();
  input.targetUsers = [
    ...input.targetUsers,
    user("source-other", "unrelated@example.test"),
  ];
  input.targetTokens = [{ id: "source-token", user_id: "existing-owner" }];
  input.targetArtifacts = [{ id: "SourcePage" }];
  input.targetReservations = [{ id: "SourceDataset" }];
  const plan = planNativeV3Identities(input);
  assert.deepEqual(plan.blockers.map((b) => b.code).sort(), [
    "artifact_id_occupied",
    "artifact_id_occupied",
    "source_user_id_occupied",
    "token_id_occupied",
  ]);
  assert.equal(plan.targets.users["source-other"], undefined);
  assert.equal(plan.targets.tokens["source-token"], undefined);
  assert.deepEqual(plan.artifactIds, {});
});
test("a guest, expired, merged, duplicate or merely display-name matching target is never treated as verified same account", () => {
  for (const target of [
    user("existing-owner", "owner@example.test", "guest"),
    {
      ...user("existing-owner", "owner@example.test"),
      expires_at: "2020-01-01T00:00:00Z",
    },
    {
      ...user("existing-owner", "owner@example.test"),
      merged_into_user_id: "another",
    },
    user("existing-owner", "different@example.test"),
  ]) {
    const input = fixture();
    input.targetUsers = [{ ...target, name: "Same Display" }];
    const plan = planNativeV3Identities(input);
    if (target.email === "different@example.test") {
      assert.equal(plan.targets.users["source-owner"]!.userId, "source-owner");
    } else assert.ok(plan.blockers.some((b) => b.sourceId === "source-owner"));
    assert.equal(
      plan.users.find((u) => u.sourceId === "source-owner")?.action ===
        "reuse-verified-email",
      false,
    );
  }
});
test("missing referenced users and duplicate normalized source identities are explicit blockers, with no silent empty identity", () => {
  const input = fixture();
  input.requiredUserIds = ["missing", "source-owner"];
  input.sourceUsers = [
    ...input.sourceUsers,
    user("same-email", "OWNER@example.test"),
  ];
  input.requiredUserIds = [...input.requiredUserIds, "same-email"];
  input.targetUsers = [];
  input.legacyMaps.users["same-email"] = "owner@example.test";
  const plan = planNativeV3Identities(input);
  assert.ok(plan.blockers.some((b) => b.code === "source_user_missing"));
  assert.equal(
    plan.blockers.filter((b) => b.code === "source_email_ambiguous").length,
    2,
  );
  assert.equal(plan.targets.users["missing"], undefined);
});
test("scope closes token owners and source parent/adoption references but never imports unrelated source accounts", () => {
  const input = fixture();
  input.sourceUsers = [
    ...input.sourceUsers,
    user("unrelated", "unused@example.test"),
  ];
  const plan = planNativeV3Identities(input);
  assert.equal(plan.targets.users.unrelated, undefined);
  assert.ok(plan.targets.users["source-owner"]);
});

test("unverified source identities and ambiguous target matches cannot inherit an account", () => {
  const input = fixture();
  input.sourceUsers = input.sourceUsers.map((u) =>
    u.id === "source-owner" ? { ...u, kind: "guest" } : u,
  );
  assert.ok(
    planNativeV3Identities(input).blockers.some(
      (b) => b.code === "source_email_unverified",
    ),
  );
  const duplicate = fixture();
  duplicate.targetUsers = [
    ...duplicate.targetUsers,
    user("another-target", "OWNER@example.test"),
  ];
  assert.ok(
    planNativeV3Identities(duplicate).blockers.some(
      (b) => b.code === "target_email_unverified",
    ),
  );
});
test("parent references close scope and are rewritten only through explicit mappings", () => {
  const input = fixture();
  input.sourceUsers = input.sourceUsers.map((u) =>
    u.id === "source-other" ? { ...u, parent_user_id: "source-owner" } : u,
  );
  input.requiredTokenIds = [];
  const plan = planNativeV3Identities(input);
  assert.equal(
    plan.createUsers.find((u) => u.id === "source-other")!.parent_user_id,
    "existing-owner",
  );
  assert.ok(plan.targets.users["source-owner"]);
});
