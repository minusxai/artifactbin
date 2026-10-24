import { it, expect } from "vitest";
import { useAppHarness, mintAccountToken } from "@/__tests__/harness";
import { getDb } from "@/lib/platform";
import { identityForUser } from "@/lib/accounts";
import { canonicalizeHtmlPage } from "@/lib/html-page";
import { pageSourceDigest } from "@/lib/registered-page-queries/registry";
import { listAnnotationsFor } from "@/lib/annotations/store";
import { importNativeHistory, prepareNativeHistoryRelations } from "../index";
import type { NativeHistoryImport } from "../contracts";
import type {
  NativeAnnotationProjection,
  NativeRelationProjection,
} from "../relation-contracts";
useAppHarness();
async function fixture() {
  const owner = await mintAccountToken("synthetic_relation_owner"),
    db = await getDb();
  const history: NativeHistoryImport = {
    sourceNamespace: "synthetic",
    sourceId: "source",
    selectionSha256: "a".repeat(64),
    projectionSha256: "b".repeat(64),
    pageId: "RelationHistory",
    owner: { userId: owner.userId!, tokenId: owner.id },
    visibility: "private",
    linkRole: "viewer",
    shares: [],
    headVersion: 3,
    revisions: [1, 3].map((version) => {
      const c = canonicalizeHtmlPage(
        `<html><head></head><body><p data-af-id="stable">A quote ${version}</p></body></html>`,
      );
      return {
        page: {
          pageId: "RelationHistory",
          version,
          revision: String(version),
          html: c.html,
          nextNodeId: c.ledger.nextNodeId,
          links: [],
        },
        ledger: c.ledger,
        sourceSha256: pageSourceDigest(c.html),
        title: null,
        description: null,
        createdAt: "2020-01-01T00:00:00.000Z",
        actorUserId: owner.userId!,
        actorTokenId: owner.id,
        queries: [],
        mutations: [],
      };
    }),
  };
  const root: NativeAnnotationProjection = {
    id: "root",
    revision: 2,
    rootId: null,
    body: "Original body",
    authorKind: "human",
    authorTokenId: owner.id,
    authorUserId: owner.userId!,
    authorLabel: "Original author",
    authorTransport: "browser",
    status: "resolved",
    resolvedAt: "2020-01-03T00:00:00.000Z",
    createdAt: "2020-01-01T00:00:00.000Z",
    editedAt: "2020-01-02T00:00:00.000Z",
    deletedAt: null,
    changeSeq: 7,
    authorRemote: null,
    snippet: "A quote",
    quote: "A quote",
    range: null,
    viewState: { v: 2, state: { $: { filter: "saved" } } },
    retainedContext: { originalRevision: "1", status: "available" },
    anchor: {
      version: 1,
      sourceNamespace: "graph",
      sourceNodeId: "old",
      quote: "A quote",
    },
  };
  const projection: NativeRelationProjection = {
    history,
    bindings: [
      {
        version: 1,
        htmlSha256: history.revisions[0]!.sourceSha256,
        sourceNamespace: "graph",
        sourceNodeId: "old",
        nodeId: "stable",
      },
    ],
    annotations: [
      root,
      {
        ...root,
        id: "reply",
        rootId: "root",
        body: "Reply",
        anchor: null,
        status: "open",
        resolvedAt: null,
      },
      {
        ...root,
        id: "deleted",
        rootId: "root",
        body: "Deleted reply",
        anchor: null,
        deletedAt: "2020-01-04T00:00:00.000Z",
      },
      {
        ...root,
        id: "unavailable",
        anchor: null,
        retainedContext: {
          status: "unavailable",
          originalRevision: "2",
          reason: "not-retained",
        },
      },
    ],
    members: [
      {
        userId: owner.userId!,
        status: "accepted",
        direction: "request",
        initiatedBy: owner.userId!,
        explicitJoin: true,
        revision: 4,
        createdAt: "2020-01-01T00:00:00.000Z",
        acceptedAt: "2020-01-02T00:00:00.000Z",
        deletedAt: null,
      },
    ],
    images: [
      {
        id: "synthetic-image",
        annotationId: "reply",
        tokenId: owner.id,
        userId: owner.userId!,
        metadata: {
          v: 1,
          capturedEditId: "1",
          capturedAt: "2020-01-01T00:00:00.000Z",
          method: "upload",
          width: 10,
          height: 10,
          rect: { x: 0, y: 0, width: 10, height: 10 },
          viewport: { width: 10, height: 10 },
          strokes: [],
        },
        bytes: 30,
        ready: true,
        expiresAt: "2020-01-02T00:00:00.000Z",
      },
    ],
  };
  return {
    db,
    history,
    projection,
    actor: identityForUser(owner.userId, owner.id),
  };
}
it("imports exact historical anchors, author/state/thread/deletion metadata and durable membership; replays and detects drift", async () => {
  const { db, history, projection, actor } = await fixture(),
    relations = prepareNativeHistoryRelations(projection);
  history.relationSha256 = relations.sourceSha256;
  expect(await importNativeHistory(db, history, relations)).toBe("created");
  const roots = await listAnnotationsFor(actor, history.pageId, {
    status: "all",
  });
  expect(roots?.map((r) => r.id)).toEqual(["root", "unavailable"]);
  expect(roots?.[0]).toMatchObject({
    anchor_version: 1,
    anchor: { kind: "html-node", revision: "1", nodeId: "stable" },
    quote: "A quote",
    status: "resolved",
    view_state: { v: 2, state: { $: { filter: "saved" } } },
    thread: [
      {
        id: "root",
        body: "Original body",
        author: { label: "Original author", user_id: history.owner.userId },
      },
      { id: "reply", body: "Reply" },
    ],
  });
  expect(roots?.[0]?.thread[1]?.image).toMatchObject({
    id: "synthetic-image",
    capturedEditId: "1",
    originalUrl:
      "/api/my/artifacts/RelationHistory/comment-images/synthetic-image?variant=original",
  });
  const outsider = await mintAccountToken("synthetic_relation_outsider");
  expect(
    await listAnnotationsFor(
      identityForUser(outsider.userId, outsider.id),
      history.pageId,
      { status: "all" },
    ),
  ).toBeNull();
  expect(roots?.[1]).toMatchObject({ anchor: null, orphaned: true });
  expect(
    (
      await db.query<{ context: unknown }>(
        "SELECT meta->'nativeRelationContext' AS context FROM artifacts WHERE id=$1",
        [history.pageId],
      )
    ).rows[0]?.context,
  ).toContainEqual({
    id: "unavailable",
    context: {
      status: "unavailable",
      originalRevision: "2",
      reason: "not-retained",
    },
  });
  expect(
    (
      await db.query<{ deleted_at: string }>(
        "SELECT deleted_at FROM annotations WHERE id='deleted'",
      )
    ).rows[0]?.deleted_at,
  ).toContain("2020-01-04");
  expect(await importNativeHistory(db, history, relations)).toBe("unchanged");
  await db.query(
    "UPDATE relations SET explicit_join=false WHERE object_id=$1",
    [history.pageId],
  );
  await expect(importNativeHistory(db, history, relations)).rejects.toThrow(
    "native_relation_mismatch",
  );
});
it("rejects wrong namespace or HTML identity proof before publishing", async () => {
  const { projection } = await fixture();
  projection.bindings = [
    { ...projection.bindings[0]!, sourceNamespace: "dom" },
  ];
  expect(() => prepareNativeHistoryRelations(projection)).toThrow(
    "native_relation_mismatch",
  );
});
it("rolls history and relations back on late verification failure", async () => {
  const { db, history, projection } = await fixture(),
    relations = prepareNativeHistoryRelations(projection);
  history.relationSha256 = relations.sourceSha256;
  await expect(
    importNativeHistory(db, history, {
      ...relations,
      async verify(tx, id) {
        await relations.verify(tx, id);
        throw Error("late_failure");
      },
    }),
  ).rejects.toThrow("late_failure");
  expect(
    (await db.query("SELECT id FROM artifacts WHERE id=$1", [history.pageId]))
      .rows,
  ).toEqual([]);
  expect(
    (
      await db.query("SELECT id FROM annotations WHERE artifact_id=$1", [
        history.pageId,
      ])
    ).rows,
  ).toEqual([]);
});

it("rejects a prepared relation proof reused with different persisted HTML", async () => {
  const { db, history, projection } = await fixture();
  const relations = prepareNativeHistoryRelations(projection);
  history.relationSha256 = relations.sourceSha256;
  const revision = history.revisions[0]!;
  revision.page.html = revision.page.html.replace(
    "A quote 1",
    "Different text",
  );
  revision.sourceSha256 = pageSourceDigest(revision.page.html);
  await expect(importNativeHistory(db, history, relations)).rejects.toThrow(
    "native_relation_mismatch",
  );
  expect(
    (await db.query("SELECT id FROM artifacts WHERE id=$1", [history.pageId]))
      .rows,
  ).toEqual([]);
});
