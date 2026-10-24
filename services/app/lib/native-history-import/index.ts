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
    !input.owner.tokenId ||
    !input.revisions.length ||
    ![input.selectionSha256, input.projectionSha256].every((v) =>
      /^[a-f0-9]{64}$/.test(v),
    )
  )
    throw fail();
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
  const allocated = new Set<string>();
  let next = 1;
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
    for (const id of r.ledger.allocatedIds) allocated.add(id);
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
  const existing = (
    await tx.query<{
      meta: { nativeImport?: unknown };
      source: string;
      version: number;
      user_id: string;
      token_id: string;
      visibility: string;
      link_role: string;
    }>(
      "SELECT meta,source,version,user_id,token_id,visibility,link_role FROM artifacts WHERE id=$1 FOR UPDATE",
      [input.pageId],
    )
  ).rows[0];
  if (existing) {
    if (
      !isDeepStrictEqual(existing.meta.nativeImport, receipt) ||
      existing.source !== head.page.html ||
      existing.version !== head.page.version ||
      existing.user_id !== input.owner.userId ||
      existing.token_id !== input.owner.tokenId ||
      existing.visibility !== input.visibility ||
      existing.link_role !== input.linkRole
    )
      throw Error("native_import_collision");
    const saved = (
      await tx.query<{
        version: number;
        source: string;
        meta: Record<string, unknown>;
      }>(
        "SELECT version,source,meta FROM artifact_versions WHERE artifact_id=$1 ORDER BY version",
        [input.pageId],
      )
    ).rows;
    if (
      saved.length !== revisions.length ||
      saved.some(
        (r, i) =>
          r.version !== revisions[i]!.page.version ||
          r.source !== revisions[i]!.page.html ||
          !isDeepStrictEqual(r.meta.htmlLinks, revisions[i]!.page.links),
      )
    )
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
    await verifyPrograms();
    if (relations) await relations.verify(tx, input.pageId);
    return "unchanged";
  }
  const reservation = await tx.query(
    "INSERT INTO artifact_id_registry(id,owner) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",
    [input.pageId, input.owner.userId],
  );
  if (!reservation.rows.length) throw Error("native_import_collision");
  const first = revisions[0]!;
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
      linkRole: input.linkRole,
      shares: input.shares,
    },
  );
  await tx.query(
    "UPDATE artifact_source_ids SET first_version=$2 WHERE artifact_id=$1",
    [input.pageId, first.page.version],
  );
  for (const r of revisions) {
    const meta = {
      htmlIdentity: r.ledger,
      htmlLinks: r.page.links,
      nativeImport: receipt,
    };
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
    for (const id of r.ledger.allocatedIds)
      await tx.query(
        "INSERT INTO artifact_source_ids(artifact_id,source_id,provenance,first_version) VALUES($1,$2,'authored',$3) ON CONFLICT DO NOTHING",
        [input.pageId, id, r.page.version],
      );
  }
  // Head reserves every historical ID, including IDs absent from current authored HTML.
  await tx.query(
    "UPDATE artifacts SET meta=jsonb_set(meta,'{htmlIdentity}',$2::jsonb),created_at=$3 WHERE id=$1",
    [
      input.pageId,
      JSON.stringify({ allocatedIds: [...allocated], nextNodeId: next }),
      first.createdAt,
    ],
  );
  await tx.query(
    "UPDATE artifact_source_ids SET retired_version=$2 WHERE artifact_id=$1 AND NOT(source_id=ANY($3::text[]))",
    [
      input.pageId,
      head.page.version,
      canonicalizeHtmlPage(head.page.html).nodeIds,
    ],
  );
  await tx.query(
    "UPDATE artifact_edits SET inserted=$2,span_end=$3,document_state=jsonb_build_object('version',$4::integer) WHERE artifact_id=$1",
    [input.pageId, head.page.html, head.page.html.length, head.page.version],
  );
  await verifyPrograms();
  if (relations) {
    await relations.apply(tx, input.pageId);
    await relations.verify(tx, input.pageId);
  }
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
