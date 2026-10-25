import { isDeepStrictEqual } from "node:util";
import {nativeRelationTimestamp} from "./relation-timestamps";
import {
  parseHtmlNodeAnchor,
  type Queryable,
  type HtmlNodeAnchor,
} from "@artifactbin/contracts";
import { htmlCommentNodes } from "@/lib/annotations/html-anchor";
import { pageSourceDigest } from "@/lib/registered-page-queries/registry";
import type { NativeImportRelations } from "./contracts";
import type { NativeRelationProjection } from "./relation-contracts";
import type {NativeArtifactRelations} from "./artifact-relation-contracts";
import {assertNativeArtifactRelations} from "./artifact-relations";
const fail = (): never => {
  throw Error("native_relation_mismatch");
};
const annotationColumns = [
  "id",
  "revision",
  "root_id",
  "body",
  "author_kind",
  "author_token_id",
  "author_user_id",
  "author_label",
  "author_transport",
  "status",
  "resolved_at",
  "created_at",
  "edited_at",
  "deleted_at",
  "change_seq",
  "author_remote",
  "snippet",
  "quote",
  "range",
  "view_state",
  "anchor_key",
  "anchor_version",
  "html_anchor",
];
const memberColumns = [
  "subject_id",
  "status",
  "direction",
  "initiated_by",
  "explicit_join",
  "revision",
  "created_at",
  "accepted_at",
  "deleted_at",
];
const imageColumns = [
  "id",
  "annotation_id",
  "token_id",
  "user_id",
  "metadata",
  "bytes",
  "ready",
  "expires_at",
];
const dates = new Set([
  "resolved_at",
  "created_at",
  "edited_at",
  "deleted_at",
  "accepted_at",
  "expires_at",
]);
function normalized(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value !== null && dates.has(key)
        ? nativeRelationTimestamp(value instanceof Date ? value : String(value))
        : key === "bytes" || (key === "change_seq" && value !== null)
          ? Number(value)
          : value,
    ]),
  );
}
/** Exact source-node bindings only. A retained but unselected context stays inert in the receipt. */
export function prepareNativeHistoryRelations(
  input: NativeRelationProjection,
  artifactRelations?: NativeArtifactRelations,
): NativeImportRelations {
  const projection = structuredClone(input),
    history = projection.history;
  if(artifactRelations){assertNativeArtifactRelations(artifactRelations,history);if(projection.members.length)fail();}
  const versions = new Map(
    history.revisions.map((r) => [
      r.page.version,
      { sha: r.sourceSha256, nodes: htmlCommentNodes(r.page.html) },
    ]),
  );
  const bindings = new Map<string, string>();
  const bindingKey = (version: number, namespace: string, id: string) =>
    JSON.stringify([version, namespace, id]);
  for (const b of projection.bindings) {
    const v = versions.get(b.version),
      key = bindingKey(b.version, b.sourceNamespace, b.sourceNodeId);
    if (
      !v ||
      v.sha !== b.htmlSha256 ||
      !v.nodes.has(b.nodeId) ||
      bindings.has(key)
    )
      fail();
    bindings.set(key, b.nodeId);
  }
  const ids = new Map<string, string | null>();
  const annotations = projection.annotations.map((a) => {
    if (
      ids.has(a.id) ||
      (a.rootId !== null && (!ids.has(a.rootId) || ids.get(a.rootId) !== null))
    )
      fail();
    ids.set(a.id, a.rootId);
    let anchor: HtmlNodeAnchor | null = null;
    if (a.anchor) {
      if (a.rootId !== null) fail();
      const nodeId = bindings.get(
        bindingKey(
          a.anchor.version,
          a.anchor.sourceNamespace,
          a.anchor.sourceNodeId,
        ),
      );
      if (!nodeId) fail();
      anchor = {
        kind: "html-node",
        v: 1,
        revision: String(a.anchor.version),
        nodeId: nodeId!,
        quote: a.anchor.quote,
        ...(a.anchor.range ? { range: a.anchor.range } : {}),
      };
    }
    if (anchor && !parseHtmlNodeAnchor(anchor)) fail();
    return normalized({
      id: a.id,
      revision: a.revision,
      root_id: a.rootId,
      body: a.body,
      author_kind: a.authorKind,
      author_token_id: a.authorTokenId,
      author_user_id: a.authorUserId,
      author_label: a.authorLabel,
      author_transport: a.authorTransport,
      status: a.status,
      resolved_at: a.resolvedAt,
      created_at: a.createdAt,
      edited_at: a.editedAt,
      deleted_at: a.deletedAt,
      change_seq: a.changeSeq,
      author_remote: a.authorRemote,
      snippet: a.snippet,
      quote: a.quote,
      range: a.range,
      view_state: a.viewState,
      anchor_key: null,
      anchor_version: a.anchor?.version ?? null,
      html_anchor: anchor,
    });
  });
  const members = projection.members.map((m) =>
    normalized({
      subject_id: m.userId,
      status: m.status,
      direction: m.direction,
      initiated_by: m.initiatedBy,
      explicit_join: m.explicitJoin,
      revision: m.revision,
      created_at: m.createdAt,
      accepted_at: m.acceptedAt,
      deleted_at: m.deletedAt,
    }),
  );
  const images = projection.images.map((i) => {
    if (
      !ids.has(i.annotationId) ||
      !i.ready ||
      !Number.isSafeInteger(i.bytes) ||
      i.bytes < 0
    )
      fail();
    return normalized({
      id: i.id,
      annotation_id: i.annotationId,
      token_id: i.tokenId,
      user_id: i.userId,
      metadata: i.metadata,
      bytes: i.bytes,
      ready: i.ready,
      expires_at: i.expiresAt,
    });
  });
  if (
    new Set(members.map((m) => m.subject_id)).size !== members.length ||
    new Set(images.map((i) => i.id)).size !== images.length ||
    new Set(images.map((i) => i.annotation_id)).size !== images.length
  )
    fail();
  const archive = projection.annotations.map((a) => ({
    id: a.id,
    context: a.retainedContext,
  }));
  const sourceSha256 = pageSourceDigest(
    JSON.stringify({
      sourceNamespace: history.sourceNamespace,
      sourceId: history.sourceId,
      pageId: history.pageId,
      revisions: history.revisions.map((r) => ({
        version: r.page.version,
        htmlSha256: r.sourceSha256,
      })),
      bindings: projection.bindings,
      annotations,
      members,
      images,
      archive,
      artifactRelations: artifactRelations?.sourceSha256,
    }),
  );
  async function insert(
    tx: Queryable,
    table: string,
    columns: string[],
    row: Record<string, unknown>,
    extra: Record<string, unknown>,
  ) {
    const all = { ...row, ...extra },
      keys = [...columns, ...Object.keys(extra)];
    await tx.query(
      `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((_, i) => "$" + (i + 1)).join(",")})`,
      keys.map((k) =>
        all[k] !== null && typeof all[k] === "object"
          ? JSON.stringify(all[k])
          : all[k],
      ),
    );
  }
  const sorted = (rows: Record<string, unknown>[], column: string) =>
    rows
      .map(normalized)
      .sort((a, b) => String(a[column]).localeCompare(String(b[column])));
  async function verifyHistory(tx: Queryable, pageId: string) {
    const saved = await tx.query<{ version: number; source: string }>(
      "SELECT version,source FROM artifact_versions WHERE artifact_id=$1 ORDER BY version",
      [pageId],
    );
    const expected = history.revisions
      .map((r) => ({ version: r.page.version, sha: r.sourceSha256 }))
      .sort((a, b) => a.version - b.version);
    if (
      !isDeepStrictEqual(
        saved.rows.map((r) => ({
          version: r.version,
          sha: pageSourceDigest(r.source),
        })),
        expected,
      )
    )
      fail();
  }
  return {
    sourceSha256,
    headMetadata: {nativeRelationContext: archive},
    async apply(tx, pageId) {
      if (pageId !== history.pageId) fail();
      await verifyHistory(tx, pageId);
      for (const row of annotations)
        await insert(tx, "annotations", annotationColumns, row, {
          artifact_id: pageId,
        });
      if(artifactRelations)await artifactRelations.apply(tx,pageId);
      for (const row of members)
        await insert(tx, "relations", memberColumns, row, {
          subject_kind: "user",
          verb: "join",
          object_kind: "artifact",
          object_id: pageId,
        });
      for (const row of images)
        await insert(tx, "comment_images", imageColumns, row, {
          artifact_id: pageId,
        });
      await tx.query(
        "UPDATE artifacts SET meta=jsonb_set(meta,'{nativeRelationContext}',$2::jsonb) WHERE id=$1",
        [pageId, JSON.stringify(archive)],
      );
    },
    async verify(tx, pageId) {
      if (pageId !== history.pageId) fail();
      await verifyHistory(tx, pageId);
      for (const [table, columns, expected, where, key] of [
        ["annotations", annotationColumns, annotations, "artifact_id=$1", "id"],
        [
          "relations",
          memberColumns,
          members,
          "object_id=$1 AND object_kind='artifact' AND subject_kind='user' AND verb='join'",
          "subject_id",
        ],
        ["comment_images", imageColumns, images, "artifact_id=$1", "id"],
      ] as const) {
        if(table === "relations" && artifactRelations)continue;
        const actual = await tx.query<Record<string, unknown>>(
          `SELECT ${columns.join(",")} FROM ${table} WHERE ${where}${table === "annotations" ? " ORDER BY seq" : ""}`,
          [pageId],
        );
        if (
          !isDeepStrictEqual(
            table === "annotations"
              ? actual.rows.map(normalized)
              : sorted(actual.rows, key),
            table === "annotations"
              ? [...expected]
              : sorted([...expected], key),
          )
        )
          fail();
      }
      if(artifactRelations)await artifactRelations.verify(tx,pageId);
      const row = (
        await tx.query<{ context: unknown }>(
          "SELECT meta->'nativeRelationContext' AS context FROM artifacts WHERE id=$1",
          [pageId],
        )
      ).rows[0];
      if (!row || !isDeepStrictEqual(row.context, archive)) fail();
    },
  };
}
