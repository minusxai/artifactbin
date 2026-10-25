import { isDeepStrictEqual } from "node:util";
import type { Db, Queryable } from "@/lib/platform/db";
import { createArtifact } from "@/lib/artifacts";
import { canonicalizeHtmlPage } from "@/lib/html-page";
import {
  commitRegisteredQueryBackend,
  pageSourceDigest,
  registeredPlan,
} from "@/lib/registered-page-queries/registry";
import {
  commitRegisteredMutationBackend,
  registeredMutationPlan,
} from "@/lib/registered-page-mutations";
import type { NativeHistoryImport, NativeImportRelations } from "./contracts";
const fail = () => Error("native_import_invalid");
/** Final lifetime reservation state, including identities absent from authored HTML. */
interface SourceIdentity {
  source_id: string;
  provenance: "authored";
  first_version: number;
  retired_version: number | null;
}
/** Trusted offline transaction body. Caller MUST supply one transaction for this writer AND relation projection.
 * It opens no connection, accepts no HTTP input, and never creates accounts or invents an ACL. */
export async function writeNativeHistory(
  tx: Queryable,
  input: NativeHistoryImport,
  relations?: NativeImportRelations,
): Promise<"created" | "unchanged"> {
  if (
    !/^[A-Za-z0-9]{6,128}$/.test(input.pageId) ||
    !input.sourceNamespace ||
    !input.sourceId ||
    !input.owner.userId ||
    (input.owner.tokenId !== null && (typeof input.owner.tokenId !== "string" || !input.owner.tokenId)) ||
    !input.revisions.length ||
    ![input.selectionSha256, input.projectionSha256].every((v) =>
      /^[a-f0-9]{64}$/.test(v),
    )
  )
    throw fail();
  if (!(await tx.query("SELECT 1 FROM users WHERE id=$1 AND kind IN ('account','testuser')", [input.owner.userId])).rows.length) throw fail();
  const revisions = [...input.revisions].sort(
      (a, b) => a.page.version - b.page.version,
    ),
    head = revisions.find((r) => r.page.version === input.headVersion);
  if (
    !head ||
    head !== revisions.at(-1) ||
    new Set(revisions.map((r) => r.page.version)).size !== revisions.length
  )
    throw fail();
  if (relations?.headMetadata !== undefined &&
      (Object.keys(relations.headMetadata).length !== 1 ||
       !Object.hasOwn(relations.headMetadata, "nativeRelationContext"))) throw fail();
  const allocated = new Set<string>();
  let next = 1;
  const identities = new Map<string, SourceIdentity>();
  for (const r of revisions) {
    const canonical = canonicalizeHtmlPage(r.page.html, {
      previousHtml: r.page.html,
      ledger: r.ledger,
    });
    if (
      r.page.pageId !== input.pageId ||
      !Number.isSafeInteger(r.page.version) ||
      r.page.version < 1 ||
      r.page.revision !== String(r.page.version) ||
      r.sourceSha256 !== pageSourceDigest(r.page.html) ||
      canonical.html !== r.page.html ||
      r.page.nextNodeId !== r.ledger.nextNodeId ||
      !Number.isSafeInteger(r.ledger.nextNodeId) ||
      r.ledger.nextNodeId < 1 ||
      !Number.isFinite(Date.parse(r.createdAt))
    )
      throw fail();
    if (canonical.nodeIds.some((id) => !r.ledger.allocatedIds.includes(id)))
      throw fail();
    if (new Set(r.ledger.allocatedIds).size !== r.ledger.allocatedIds.length ||
        [...allocated].some(id => !r.ledger.allocatedIds.includes(id)) ||
        r.ledger.nextNodeId < next) throw fail();
    const active = new Set(canonical.nodeIds);
    for (const id of r.ledger.allocatedIds) {
      allocated.add(id);
      if (!identities.has(id)) identities.set(id, { source_id: id, provenance: "authored", first_version: r.page.version, retired_version: null });
      const identity = identities.get(id)!;
      if (active.has(id)) identity.retired_version = null;
      else if (identity.retired_version === null) identity.retired_version = r.page.version;
    }
    next = Math.max(next, r.ledger.nextNodeId);
    const programs = [...r.queries, ...r.mutations];
    if (
      new Set(r.page.links.map((l) => l.name)).size !== r.page.links.length ||
      r.page.links.filter((l) => l.kind === "backend").length !==
        programs.length ||
      programs.some(
        (p) =>
          !r.page.links.some(
            (l) =>
              l.kind === "backend" &&
              JSON.stringify(l) === JSON.stringify(p.link),
          ),
      )
    )
      throw fail();
  }
  if (
    input.relationSha256 !== relations?.sourceSha256 ||
    (input.revisions.some((r) =>
      r.page.links.some((l) => l.kind === "dataset"),
    ) &&
      !relations)
  )
    throw fail();
  const verifyPrograms = async () => {
    for (const r of revisions)
      for (const [prepared, validate] of [
        ...r.queries.map((p) => [p, registeredPlan] as const),
        ...r.mutations.map((p) => [p, registeredMutationPlan] as const),
      ]) {
        const record = (
          await tx.query<{
            backend_id: string;
            version: string;
            page_id: string;
            name: string;
            source: string;
            type_defs: string;
            compiled: string;
            owner_id: string;
            secret_bindings: string[];
          }>(
            "SELECT * FROM html_backend_versions WHERE backend_id=$1 AND version=$2",
            [prepared.link.backendId, prepared.link.version],
          )
        ).rows[0];
        if (
          !record ||
          record.owner_id !== input.owner.userId ||
          !validate(r.page, prepared.link, {
            backendId: record.backend_id,
            version: record.version,
            pageId: record.page_id,
            name: record.name,
            source: record.source,
            typeDefs: record.type_defs,
            compiled: record.compiled,
            ownerId: record.owner_id,
            secretBindings: record.secret_bindings,
          })
        )
          throw Error("native_import_collision");
      }
  };
  const receipt = {
    sourceNamespace: input.sourceNamespace,
    sourceId: input.sourceId,
    selectionSha256: input.selectionSha256,
    projectionSha256: input.projectionSha256,
    inputSha256: pageSourceDigest(JSON.stringify(input)),
  };
  await tx.query(
    "SELECT pg_advisory_xact_lock(hashtext('native-import:' || $1))",
    [input.pageId],
  );
  const first = revisions[0]!;
  const revisionMeta = (r: (typeof revisions)[number]) => ({
    htmlIdentity: r.ledger, htmlLinks: r.page.links, nativeImport: receipt,
    ...(r.htmlPublicationDependencies === undefined ? {} : {htmlPublicationDependencies: r.htmlPublicationDependencies}),
  });
  interface StoredRevision {
    version: number; source: string; title: string | null; description: string | null;
    format: string; document: unknown; meta: Record<string, unknown>;
    actor_user_id: string | null; actor_token_id: string | null;
  }
  interface StoredHead extends StoredRevision {
    creator_user_id: string; user_id: string; token_id: string | null; visibility: string; link_role: string;
    deleted_at: Date | string | null; group_id: string | null;
  }
  const matchesRevision = (row: StoredRevision, r: (typeof revisions)[number], meta = revisionMeta(r)) =>
    row.version === r.page.version && row.source === r.page.html &&
    row.title === r.title && row.description === r.description && row.format === "html" && row.document === null &&
    row.actor_user_id === r.actorUserId && row.actor_token_id === r.actorTokenId &&
    isDeepStrictEqual(row.meta, meta);
  const verifyProjection = async () => {
    const row = (await tx.query<StoredHead>("SELECT * FROM artifacts WHERE id=$1", [input.pageId])).rows[0];
    if (!row || !matchesRevision(row, head, {...revisionMeta(head), ...relations?.headMetadata}) || row.user_id !== input.owner.userId ||
        row.token_id !== input.owner.tokenId || row.visibility !== input.visibility ||
        row.link_role !== input.linkRole || row.creator_user_id !== input.owner.userId || row.deleted_at !== null || row.group_id !== null)
      throw Error("native_import_collision");
    const saved = (await tx.query<StoredRevision>(
      "SELECT * FROM artifact_versions WHERE artifact_id=$1 ORDER BY version", [input.pageId])).rows;
    if (saved.length !== revisions.length || saved.some((r, i) =>
        !matchesRevision(r, revisions[i]!)))
      throw Error("native_import_collision");
    // Compare in Postgres: driver Date values truncate timestamp microseconds.
    const changedTimes = await tx.query(
      `SELECT 1 FROM artifacts WHERE id=$1 AND (created_at<>$2::timestamptz OR updated_at<>$3::timestamptz)
       UNION ALL
       SELECT 1 FROM artifact_versions v
       JOIN jsonb_to_recordset($4::jsonb) AS expected(version integer, created_at timestamptz) ON v.version=expected.version
       WHERE v.artifact_id=$1 AND v.created_at<>expected.created_at`,
      [input.pageId, first.createdAt, head.createdAt, JSON.stringify(revisions.map(r => ({version: r.page.version, created_at: r.createdAt})))],
    );
    if (changedTimes.rows.length) throw Error("native_import_collision");
    const sourceIds = (await tx.query<{source_id: string; provenance: string; first_version: number; retired_version: number | null}>(
      "SELECT source_id,provenance,first_version,retired_version FROM artifact_source_ids WHERE artifact_id=$1 ORDER BY source_id", [input.pageId])).rows;
    if (!isDeepStrictEqual(sourceIds, [...identities.values()].sort((a,b) => a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0)))
      throw Error("native_import_collision");
    const shares = (
      await tx.query<{ email: string; role: string }>(
        "SELECT email,role FROM artifact_shares WHERE artifact_id=$1 ORDER BY email",
        [input.pageId],
      )
    ).rows;
    const expectedShares = (input.shares ?? [])
      .map((s) => ({ email: s.email.trim().toLowerCase(), role: s.role }))
      .sort((a, b) => a.email.localeCompare(b.email));
    if (!isDeepStrictEqual(shares, expectedShares))
      throw Error("native_import_collision");
  };
  const existing = (await tx.query<{meta: {nativeImport?: unknown}}>(
    "SELECT meta FROM artifacts WHERE id=$1 FOR UPDATE", [input.pageId])).rows[0];
  if (existing) {
    if (!isDeepStrictEqual(existing.meta.nativeImport, receipt)) throw Error("native_import_collision");
    await verifyProjection();
    await verifyPrograms();
    if (relations) await relations.verify(tx, input.pageId);
    return "unchanged";
  }
  const reservation = await tx.query(
    "INSERT INTO artifact_id_registry(id,owner) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",
    [input.pageId, input.owner.userId],
  );
  if (!reservation.rows.length) throw Error("native_import_collision");
  await createArtifact(
    input.owner.tokenId,
    input.owner.userId,
    {
      format: "html",
      source: first.page.html,
      title: first.title,
      description: first.description,
      visibility: input.visibility,
      meta: {},
    },
    {
      tx,
      reservedId: input.pageId,
      seedOwnerParticipation: false,
      linkRole: input.linkRole,
      shares: input.shares,
    },
  );
  for (const r of revisions) {
    const meta = revisionMeta(r);
    await tx.query(
      "UPDATE artifacts SET version=$2,source=$3,title=$4,description=$5,meta=$6::jsonb,actor_user_id=$7,actor_token_id=$8,updated_at=$9 WHERE id=$1",
      [
        input.pageId,
        r.page.version,
        r.page.html,
        r.title,
        r.description,
        JSON.stringify(meta),
        r.actorUserId,
        r.actorTokenId,
        r.createdAt,
      ],
    );
    await tx.query(
      "INSERT INTO artifact_versions(artifact_id,version,title,description,format,source,meta,actor_user_id,actor_token_id,created_at) VALUES($1,$2,$3,$4,'html',$5,$6::jsonb,$7,$8,$9)",
      [
        input.pageId,
        r.page.version,
        r.title,
        r.description,
        r.page.html,
        JSON.stringify(meta),
        r.actorUserId,
        r.actorTokenId,
        r.createdAt,
      ],
    );
    for (const prepared of r.queries)
      await commitRegisteredQueryBackend(
        tx,
        r.page,
        input.owner.userId,
        prepared,
      );
    for (const prepared of r.mutations)
      await commitRegisteredMutationBackend(
        tx,
        r.page,
        input.owner.userId,
        prepared,
      );
  }
  // Head reserves every historical ID, including IDs absent from current authored HTML.
  await tx.query(
    "UPDATE artifacts SET meta=jsonb_set(meta,'{htmlIdentity}',$2::jsonb),created_at=$3 WHERE id=$1",
    [
      input.pageId,
      JSON.stringify(head.ledger),
      first.createdAt,
    ],
  );
  // The complete lifetime state was computed before any writes. Reconcile genesis
  // reservations and absent historical IDs together, retaining stored provenance
  // so the exact readback still detects an incompatible prior reservation.
  await tx.query(
    `INSERT INTO artifact_source_ids(artifact_id,source_id,provenance,first_version,retired_version)
     SELECT $1, expected.source_id, expected.provenance, expected.first_version, expected.retired_version
     FROM jsonb_to_recordset($2::jsonb) AS expected(source_id text,provenance text,first_version integer,retired_version integer)
     ON CONFLICT (artifact_id,source_id) DO UPDATE
     SET first_version=EXCLUDED.first_version, retired_version=EXCLUDED.retired_version`,
    [input.pageId, JSON.stringify([...identities.values()])],
  );
  await tx.query(
    "UPDATE artifact_edits SET inserted=$2,span_end=$3,document_state=jsonb_build_object('version',$4::integer) WHERE artifact_id=$1",
    [input.pageId, head.page.html, head.page.html.length, head.page.version],
  );
  if (relations) {
    await relations.apply(tx, input.pageId);
    await relations.verify(tx, input.pageId);
  }
  await verifyProjection();
  await verifyPrograms();
  return "created";
}

/** Bounded host adapter entry point: the complete page/history/program/relation projection commits once. */
export function importNativeHistory(
  db: Pick<Db, "transaction">,
  input: NativeHistoryImport,
  relations?: NativeImportRelations,
) {
  return db.transaction((tx) => writeNativeHistory(tx, input, relations));
}

export { prepareNativeHistoryRelations } from './relations';

export {prepareNativeArtifactRelations} from "./artifact-relations";
export type {NativeArtifactRelationsInput,NativeArtifactRelationRow} from "./artifact-relation-contracts";
