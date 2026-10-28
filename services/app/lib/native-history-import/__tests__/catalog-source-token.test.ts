import { it, expect } from "vitest";
import { verifyNativeCanonicalDatasets } from "../catalog-source";
import { nativeCatalogBytes, nativeCatalogDigest } from "../catalog-digest";
import type {
  NativeCatalogProjection,
  NativeCatalogObjectSource,
} from "../catalog-contracts";
/** Actor tokens already admit null in the public catalogue contract; raw sentinels remain raw evidence. */
function fixture(actorToken: unknown = "", actorUser: unknown = "source-user") {
  const date = "2020-01-01T00:00:00.000Z",
    head = {
      id: "DataAA",
      version: 2,
      format: "dataset",
      source: null,
      meta: {},
      title: "Synthetic data",
      description: null,
      token_id: "source-token",
      user_id: "source-user",
      creator_user_id: "source-user",
      group_id: null,
      ancestor_ids: [],
      actor_user_id: actorUser,
      actor_token_id: actorToken,
      edit_id: "edit",
      visibility: "private",
      link_role: "viewer",
      access: "read",
      dataset_policy: null,
      sharing_revision: 0,
      policy_revision: 2,
      created_at: date,
      updated_at: date,
      deleted_at: null,
    };
  const raw = Buffer.from(JSON.stringify({ heads: [head], versions: [] })),
    relations = Buffer.from(
      JSON.stringify({
        heads: [{ id: head.id, version: 2, updated_at: date }],
        artifact_shares: [],
        dataset_policy_audit: [
          {
            dataset_id: head.id,
            revision: 2,
            policy: null,
            actor_user_id: actorUser,
            actor_token_id: actorToken,
            created_at: date,
          },
        ],
      }),
    );
  const projection: NativeCatalogProjection = {
    revisionScope: "latest",
    sourceNamespace: "synthetic",
    selectionSha256: "a".repeat(64),
    sourceManifestSha256: "b".repeat(64),
    objectManifestSha256: "c".repeat(64),
    sha256: "d".repeat(64),
    imports: [],
    objects: [],
    identities: {
      users: { "source-user": "target-user" },
      tokens: { "source-token": "target-token" },
      groups: {},
      artifacts: { DataAA: "DataAA" },
    },
    datasets: [
      {
        sourceId: "DataAA",
        targetId: "DataAA",
        sourceSha256: nativeCatalogBytes(raw),
        relationsSha256: nativeCatalogBytes(relations),
        currentVersion: 2,
        expectedVersions: [2],
        versions: [
          {
            version: 2,
            sourceSha256: nativeCatalogDigest(head),
            source: null,
            meta: {},
            title: head.title,
            description: null,
            createdAt: date,
            actorUserId: "target-user",
            actorTokenId: actorToken === "source-token" ? "target-token" : null,
          },
        ],
        policyAudit: [
          {
            revision: 2,
            policy: null,
            actorUserId: "target-user",
            actorTokenId: actorToken === "source-token" ? "target-token" : null,
            createdAt: date,
          },
        ],
        authority: {
          tokenId: "target-token",
          userId: "target-user",
          creatorUserId: "target-user",
          groupId: null,
          ancestorIds: [],
          visibility: "private",
          linkRole: "viewer",
          access: "read",
          datasetPolicy: null,
          sharingRevision: 0,
          policyRevision: 2,
          editId: "edit",
          createdAt: date,
          updatedAt: date,
          deletedAt: null,
          shares: [],
        },
      },
    ],
  };
  const source: NativeCatalogObjectSource = {
    dataset: async () => raw,
    relations: async () => relations,
    objectManifestSha256: projection.objectManifestSha256,
    read: async () => {
      throw Error("unexpected object read");
    },
  };
  return { projection, source, raw, relations };
}
it("accepts empty token audit and version actors as null while preserving exact raw source bytes and owner identity", async () => {
  const x = fixture(),
    before = {
      raw: Buffer.from(x.raw),
      relations: Buffer.from(x.relations),
      projection: structuredClone(x.projection),
    };
  await expect(
    verifyNativeCanonicalDatasets(x.projection, x.source),
  ).resolves.toEqual([]);
  expect(x.raw.equals(before.raw)).toBe(true);
  expect(x.relations.equals(before.relations)).toBe(true);
  expect(x.projection).toEqual(before.projection);
  expect(
    JSON.parse(x.relations.toString()).dataset_policy_audit[0].actor_token_id,
  ).toBe("");
  expect(x.projection.datasets[0]!.authority.tokenId).toBe("target-token");
});
it("rejects nonempty unmapped actor tokens and empty users", async () => {
  for (const x of [fixture("unmapped-token"), fixture("", "")])
    await expect(
      verifyNativeCanonicalDatasets(x.projection, x.source),
    ).rejects.toThrow("native_catalog_identity_unmapped");
});

it("keeps explicit null and reviewed nonempty token actor mappings intact", async () => {
  for (const value of [null, "source-token"]) {
    const x = fixture(value);
    await expect(
      verifyNativeCanonicalDatasets(x.projection, x.source),
    ).resolves.toEqual([]);
  }
});
