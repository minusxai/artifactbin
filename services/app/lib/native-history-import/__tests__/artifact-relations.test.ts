import { createHash } from "node:crypto";
import { it, expect } from "vitest";
import { useAppHarness, mintAccountToken } from "@/__tests__/harness";
import { getDb } from "@/lib/platform";
import { JOIN_RELATIONS } from "@/lib/accounts";
import { nativeIdentityDigest } from "@/lib/native-identity-import/model";
import { prepareNativeArtifactRelations } from "../index";
import { prepareNativeHistoryRelations, writeNativeHistory } from "../index";
import { canonicalizeHtmlPage } from "@/lib/html-page";
import { pageSourceDigest } from "@/lib/registered-page-queries/registry";
import type { NativeHistoryImport } from "../contracts";
import type {
  NativeArtifactRelationsInput,
  NativeArtifactRelationRow,
} from "../index";
useAppHarness();
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const sha = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
function fixture(
  rows: Partial<NativeArtifactRelationRow>[] = [{}],
): NativeArtifactRelationsInput {
  const source = bytes({
      heads: [{ id: "source_page", version: 3, edit_id: "source_edit" }],
    }),
    receipt = {
      id: "source_page",
      path: "source.json",
      sha256: sha(source),
      expectedVersion: 3,
      bytes: source.length,
    };
  const selection = bytes({ receipts: [receipt] }),
    capture = bytes({
      snapshot: [{ read_only: "on" }],
      relations: rows.map((row, i) => ({
        subject_kind: "user",
        subject_id: "source_user",
        verb: i ? "like" : "join",
        object_kind: "artifact",
        object_id: "source_page",
        created_at: "2020-01-01T00:00:00.123456Z",
        deleted_at: null,
        status: "accepted",
        direction: "request",
        initiated_by: "source_user",
        explicit_join: false,
        accepted_at: "2020-01-01T00:00:00.654321Z",
        revision: 7,
        ...row,
      })),
    }),
    witness = bytes({
      snapshot: [{ read_only: "on" }],
      relations: [{ id: "source_page", version: 3, edit_id: "source_edit" }],
    });
  const body = {
    sourceNamespace: "synthetic",
    sourceInventorySha256: "a".repeat(64),
    targetInventorySha256: "b".repeat(64),
    targets: {
      users: { source_user: { userId: "target_user", email: null } },
      tokens: {},
      actors: {},
    },
    users: [
      {
        sourceId: "source_user",
        targetId: "target_user",
        action: "create-preserved" as const,
        sourceRowSha256: "c".repeat(64),
      },
    ],
    createUsers: [],
    tokens: [],
    blockers: [],
    artifactIds: { source_page: "TargetPage" },
  };
  const identityPlan = { ...body, sha256: nativeIdentityDigest(body) };
  return {
    history: {
      sourceNamespace: "synthetic",
      sourceId: "source_page",
      pageId: "TargetPage",
      selectionSha256: sha(selection),
      projectionSha256: "d".repeat(64),
      headVersion: 3,
    },
    source: {
      capture,
      selectionManifest: selection,
      canonicalSource: source,
      headWitness: witness,
    },
    approved: {
      captureSha256: sha(capture),
      selectionManifestSha256: sha(selection),
      headWitnessSha256: sha(witness),
      identityPlanSha256: identityPlan.sha256,
    },
    identityPlan,
  };
}
it("admits exact captured state and rejects source tampering, scope expansion and wrong current head", () => {
  const input = fixture();
  expect(prepareNativeArtifactRelations(input).sourceSha256).toMatch(
    /^[a-f0-9]{64}$/,
  );
  for (const alter of [
    (i: NativeArtifactRelationsInput) => {
      i.source.capture = bytes({ relations: [] });
    },
    (i: NativeArtifactRelationsInput) => {
      i.history.pageId = "another_page";
    },
    (i: NativeArtifactRelationsInput) => {
      i.history.headVersion = 4;
    },
    (i: NativeArtifactRelationsInput) => {
      i.identityPlan.users[0]!.targetId = "another_user";
    },
  ]) {
    const changed = structuredClone(input);
    alter(changed);
    expect(() => prepareNativeArtifactRelations(changed)).toThrow();
  }
  const outside = fixture([{ object_id: "unselected" }]);
  expect(() => prepareNativeArtifactRelations(outside)).toThrow();
  const unknown = fixture([{ status: "promoted" as never }]);
  expect(() => prepareNativeArtifactRelations(unknown)).toThrow();
});
async function databaseFixture(input: NativeArtifactRelationsInput) {
  const db = await getDb(),
    owner = await mintAccountToken("synthetic_membership_owner");
  await db.query("UPDATE users SET id=$2 WHERE id=$1", [
    owner.userId,
    "target_user",
  ]);
  await db.query("UPDATE tokens SET user_id=$2 WHERE user_id=$1", [
    owner.userId,
    "target_user",
  ]);
  await db.query(
    "INSERT INTO artifacts(id,format,meta,token_id,version) VALUES('TargetPage','html',$1::jsonb,$2,3)",
    [JSON.stringify({ nativeImport: input.history }), owner.id],
  );
  await db.query(
    "INSERT INTO native_identity_imports(source_namespace,kind,source_id,target_id,action,source_sha256,target_sha256,projection_sha256,source_inventory_sha256,target_inventory_sha256,original_state,created_at) VALUES('synthetic','user','source_user','target_user','create-preserved',$1,$1,$2,$1,$1,'{}',now())",
    ["a".repeat(64), input.identityPlan.sha256],
  );
  return db;
}
it.each(["accepted", "pending", "left"] as const)(
  "imports %s state, remaps identity, preserves microseconds and replays without resetting target state",
  async (status) => {
    const input = fixture([
      {
        status,
        accepted_at:
          status === "pending" ? null : "2020-01-01T00:00:00.654321Z",
        deleted_at: status === "left" ? "2020-02-01T00:00:00.999999Z" : null,
      },
      { status: "accepted" },
    ]);
    const db = await databaseFixture(input),
      adapter = prepareNativeArtifactRelations(input);
    await db.transaction(async (tx) => {
      await adapter.apply(tx, "TargetPage");
      await adapter.verify(tx, "TargetPage");
    });
    await db.transaction(async (tx) => {
      await adapter.apply(tx, "TargetPage");
      await adapter.verify(tx, "TargetPage");
    });
    const rows = (
      await db.query<{ row: NativeArtifactRelationRow }>(
        "SELECT to_jsonb(r) AS row FROM relations r WHERE object_id='TargetPage' ORDER BY verb",
      )
    ).rows;
    expect(rows).toHaveLength(2);
    expect(
      (
        await db.query(
          `SELECT user_id FROM ${JOIN_RELATIONS} AS members WHERE artifact_id=$1 AND status='accepted'`,
          ["TargetPage"],
        )
      ).rows,
    ).toHaveLength(status === "accepted" ? 1 : 0);
    expect(rows[0]!.row).toMatchObject({
      subject_id: "target_user",
      initiated_by: "target_user",
      status,
      revision: 7,
    });
    expect(rows[0]!.row.created_at).toContain(".123456");
    expect(
      rows[0]!.row.accepted_at === null ||
        rows[0]!.row.accepted_at.includes(".654321"),
    ).toBe(true);
    await db.query(
      "UPDATE relations SET revision=revision+1 WHERE object_id='TargetPage' AND verb='join'",
    );
    await expect(
      db.transaction((tx) => adapter.apply(tx, "TargetPage")),
    ).rejects.toThrow("native_artifact_relation_mismatch");
  },
);
it("verifies the empty source set and rolls back inserts when identity authority or durable source scope differs", async () => {
  const input = fixture([]),
    db = await databaseFixture(input),
    adapter = prepareNativeArtifactRelations(input);
  await db.transaction(async (tx) => {
    await adapter.apply(tx, "TargetPage");
    await adapter.verify(tx, "TargetPage");
  });
  expect(
    (await db.query("SELECT * FROM relations WHERE object_id='TargetPage'"))
      .rows,
  ).toEqual([]);
  const populated = prepareNativeArtifactRelations(fixture());
  await db.query("UPDATE native_identity_imports SET projection_sha256=$1", [
    "e".repeat(64),
  ]);
  await expect(
    db.transaction((tx) => populated.apply(tx, "TargetPage")),
  ).rejects.toThrow("native_artifact_relation_mismatch");
  expect(
    (await db.query("SELECT * FROM relations WHERE object_id='TargetPage'"))
      .rows,
  ).toEqual([]);
  await db.query("UPDATE artifacts SET meta='{}'");
  await expect(
    db.transaction((tx) => adapter.verify(tx, "TargetPage")),
  ).rejects.toThrow("native_artifact_relation_mismatch");
});

it.each([
  { rows: [] },
  { rows: [{}] },
  { rows: [{ status: "pending" as const, accepted_at: null }] },
  {
    rows: [
      { status: "left" as const, deleted_at: "2020-02-01T00:00:00.123456Z" },
    ],
  },
])(
  "composes exact source memberships atomically with publication and replay (%j)",
  async ({ rows }) => {
    const input = fixture(rows),
      db = await databaseFixture(input);
    await db.query("DELETE FROM artifacts WHERE id='TargetPage'");
    const owner = {
        userId: "target_user",
        id: (
          await db.query<{ id: string }>(
            "SELECT id FROM tokens WHERE user_id=$1",
            ["target_user"],
          )
        ).rows[0]!.id,
      },
      canonical = canonicalizeHtmlPage(
        '<html><head></head><body><p data-af-id="stable">Synthetic</p></body></html>',
      );
    const history: NativeHistoryImport = {
      ...input.history,
      owner: { userId: owner.userId!, tokenId: owner.id },
      visibility: "private",
      linkRole: "viewer",
      shares: [],
      revisions: [
        {
          page: {
            pageId: "TargetPage",
            version: 3,
            revision: "3",
            html: canonical.html,
            nextNodeId: canonical.ledger.nextNodeId,
            links: [],
          },
          ledger: canonical.ledger,
          sourceSha256: pageSourceDigest(canonical.html),
          title: null,
          description: null,
          createdAt: "2020-01-01T00:00:00.000Z",
          actorUserId: owner.userId!,
          actorTokenId: owner.id,
          queries: [],
          mutations: [],
        },
      ],
    };
    const delegated = prepareNativeArtifactRelations({ ...input, history }),
      projection = {
        history,
        bindings: [],
        annotations: [],
        members: [],
        images: [],
      };
    const adapter = prepareNativeHistoryRelations(projection, delegated);
    history.relationSha256 = adapter.sourceSha256;
    expect(
      await db.transaction((tx) => writeNativeHistory(tx, history, adapter)),
    ).toBe("created");
    expect(
      await db.transaction((tx) => writeNativeHistory(tx, history, adapter)),
    ).toBe("unchanged");
    expect(
      (await db.query("SELECT * FROM relations WHERE object_id='TargetPage'"))
        .rows,
    ).toHaveLength(rows.length);
    expect(() =>
      prepareNativeHistoryRelations(projection, { ...delegated }),
    ).toThrow("native_artifact_relation_mismatch");
    expect(() =>
      prepareNativeHistoryRelations(
        {
          ...projection,
          members: [
            {
              userId: owner.userId!,
              status: "accepted",
              direction: "request",
              initiatedBy: null,
              explicitJoin: true,
              revision: 1,
              createdAt: "2020-01-01T00:00:00Z",
              acceptedAt: null,
              deletedAt: null,
            },
          ],
        },
        delegated,
      ),
    ).toThrow("native_relation_mismatch");
  },
);

it("admits only reviewed replacement receipts inside the original selected scope", () => {
  const input = fixture(),
    manifest = JSON.parse(
      Buffer.from(input.source.selectionManifest).toString(),
    ),
    prior = manifest.receipts[0];
  const replacement = bytes({
    heads: [{ id: "source_page", version: 4, edit_id: "new_edit" }],
  });
  const overlay = {
    format: "native-latest-two-head-refresh-v1",
    revisionScope: "latest",
    originalSelectionCount: 1,
    selectionUnchanged: true,
    priorManifestSha256: input.approved.selectionManifestSha256,
    receipts: [
      {
        ...prior,
        sha256: sha(replacement),
        bytes: replacement.length,
        expectedVersion: 4,
        revisionScope: "latest",
        priorReceipt: prior,
      },
    ],
    invalidatedSourceIds: ["source_page"],
    productionWrites: false,
  };
  input.source.refreshManifest = bytes(overlay);
  input.approved.refreshManifestSha256 = sha(input.source.refreshManifest);
  input.source.canonicalSource = replacement;
  input.history.headVersion = 4;
  expect(() => prepareNativeArtifactRelations(input)).toThrow();
  input.source.headWitness = bytes({
    snapshot: [{ read_only: "on" }],
    relations: [{ id: "source_page", version: 4, edit_id: "new_edit" }],
  });
  input.approved.headWitnessSha256 = sha(input.source.headWitness);
  expect(prepareNativeArtifactRelations(input).sourceSha256).toMatch(
    /^[a-f0-9]{64}$/,
  );
  overlay.receipts[0]!.priorReceipt = { ...prior, sha256: "f".repeat(64) };
  input.source.refreshManifest = bytes(overlay);
  input.approved.refreshManifestSha256 = sha(input.source.refreshManifest);
  expect(() => prepareNativeArtifactRelations(input)).toThrow();
});
it("rolls back relation changes when the publication revision changed and keeps ordinary owner auto participation", async () => {
  const input = fixture(),
    db = await databaseFixture(input),
    adapter = prepareNativeArtifactRelations(input);
  await expect(
    db.transaction(async (tx) => {
      await adapter.apply(tx, "TargetPage");
      await tx.query("UPDATE artifacts SET version=4 WHERE id='TargetPage'");
      await adapter.verify(tx, "TargetPage");
    }),
  ).rejects.toThrow("native_artifact_relation_mismatch");
  expect(
    (await db.query("SELECT * FROM relations WHERE object_id='TargetPage'"))
      .rows,
  ).toHaveLength(0);
  const owner = await mintAccountToken("synthetic_ordinary_owner");
  const { createArtifact } = await import("@/lib/artifacts");
  const ordinary = await createArtifact(owner.id, owner.userId!, {
    format: "html",
    source: "<html><head></head><body>Ordinary</body></html>",
    meta: {},
  });
  expect(
    (
      await db.query(
        "SELECT status FROM relations WHERE object_id=$1 AND subject_id=$2 AND verb='join'",
        [ordinary.id, owner.userId],
      )
    ).rows,
  ).toEqual([{ status: "accepted" }]);
});
