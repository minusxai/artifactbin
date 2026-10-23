import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assertHistoricalSourceQueryAuthority } from "../datasets/source-query/historical-authority.ts";
import type { SourceQueryRegistration } from "../datasets/source-query/contracts.ts";
import type { DatasetCallContext } from "../datasets/contracts.ts";
import type { DatasetViewerSnapshot } from "../datasets/viewer-contracts.ts";
import type { SqlClient } from "./sql-contracts.ts";
import { loadGroupAuthority } from "./group-memberships.ts";
import { loadDocumentHeader } from "./document-records.ts";
import { authorizePageRead } from "../server/document-authorization.ts";
/** Separate from generic viewer exposure. The server registry fixes every historical
 * operation and its saved backend/page link; current owner and ACL are always fresh. */
export async function loadHistoricalSourceQueryViewer(
  client: SqlClient,
  context: DatasetCallContext,
  now: number,
): Promise<DatasetViewerSnapshot | null> {
  const rows = (
    await client.query(
      `SELECT q.page_version,q.name,q.registration,b.owner AS backend_owner FROM dataset_source_queries q
    JOIN af_backend_versions v ON v.file_id=q.backend_id AND v.version=q.backend_version AND v.page_id=q.page_id AND v.page_version=q.page_version
    JOIN af_page_backends p ON p.page_id=q.page_id AND p.page_version=q.page_version AND p.file_id=q.backend_id AND p.version=q.backend_version
    JOIN files f ON f.id=q.page_id AND f.deleted_at IS NULL
    JOIN af_backend_files b ON b.file_id=q.backend_id AND b.owner=f.owner
    WHERE q.backend_id=$1 AND q.backend_version=$2 AND q.page_id=$3`,
      [context.backendId, context.backendVersion, context.pageId],
    )
  ).rows;
  if (!rows.length) return null;
  let first: SourceQueryRegistration | undefined;
  for (const row of rows) {
    const r = row.registration as SourceQueryRegistration,
      h = r?.historicalAuthority;
    if (
      !h ||
      r.backendId !== context.backendId ||
      r.backendVersion !== context.backendVersion ||
      r.pageId !== context.pageId ||
      r.pageVersion !== Number(row.page_version) ||
      r.name !== row.name
    )
      return null;
    try {
      assertHistoricalSourceQueryAuthority(h, {
        ...r,
        pageLegacyId: r.pageLegacyId,
      });
    } catch {
      return null;
    }
    if (first && !isDeepStrictEqual(first.historicalAuthority, h)) return null;
    first = r;
  }
  const registration = first!;
  await client.query(
    "SELECT id FROM files WHERE id=$1 AND deleted_at IS NULL FOR SHARE",
    [context.pageId],
  );
  const page = await loadDocumentHeader(client, context.pageId);
  if (
    !page ||
    Number(page.head) < registration.pageVersion ||
    rows.some((row) => row.backend_owner !== page.owner)
  )
    return null;
  const groupAuthority = context.subject
    ? await loadGroupAuthority(client, context.subject)
    : undefined;
  if (
    context.subject &&
    !(
      await client.query(
        "SELECT actor FROM accounts WHERE actor=$1 AND principal_kind='user' FOR SHARE",
        [context.subject],
      )
    ).rows.length
  )
    return null;
  try {
    authorizePageRead({
      fileId: context.pageId,
      document: page,
      session: context.subject
        ? {
            actor: context.subject,
            fileId: null,
            generation: null,
            expires: now + 1,
            groupAuthority,
          }
        : null,
      now,
    });
  } catch {
    return null;
  }
  let id: string | null = null;
  if (context.subject) {
    const mappings = (
      await client.query(
        "SELECT legacy_id,identity,expires_at FROM dataset_principals WHERE source_namespace=$1 AND actor=$2 AND kind='user' ORDER BY legacy_id FOR SHARE",
        [registration.sourceNamespace, context.subject],
      )
    ).rows;
    if (mappings.length !== 1) return null;
    const mapping = mappings[0]!;
    if (
      !["user", "testuser"].includes(String(mapping.identity)) ||
      typeof mapping.legacy_id !== "string" ||
      !mapping.legacy_id ||
      mapping.legacy_id.length > 256
    )
      return null;
    if (mapping.expires_at != null) {
      const expiry =
        mapping.expires_at instanceof Date
          ? mapping.expires_at.getTime()
          : Date.parse(String(mapping.expires_at));
      if (!Number.isFinite(expiry) || expiry <= now) return null;
    }
    id = mapping.legacy_id;
  }
  return {
    generation: createHash("sha256")
      .update(
        JSON.stringify([
          context.backendId,
          context.backendVersion,
          registration.historicalAuthority,
          page.id,
          page.owner,
          page.head,
          page.generation,
          page.access,
          context.subject,
          id,
        ]),
      )
      .digest("hex"),
    id,
  };
}
