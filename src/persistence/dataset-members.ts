import { createHash } from "node:crypto";
import type { SqlClient, SqlDatabase } from "./sql-contracts.ts";
import type { DatasetCallContext } from "../datasets/contracts.ts";
import type {
  DatasetMembersPorts,
  DatasetMembersSnapshot,
} from "../datasets/members-contracts.ts";
import { loadDocumentHeader } from "./document-records.ts";
import { loadGroupAuthority } from "./group-memberships.ts";
import { authorizePageRead } from "../server/document-authorization.ts";
/** Lock the parent page before reading joins; join writers must take its exclusive lock. */
export async function loadDatasetMembers(
  client: SqlClient,
  context: DatasetCallContext,
  now: number,
): Promise<DatasetMembersSnapshot | null> {
  const groupAuthority = context.subject
    ? await loadGroupAuthority(client, context.subject)
    : undefined;
  const binding = (
    await client.query(
      `SELECT DISTINCT b.source_namespace,b.page_version FROM dataset_member_bindings b
    JOIN files f ON f.id=b.page_id AND f.head=b.page_version::text
    WHERE b.backend_id=$1 AND b.backend_version=$2 AND b.page_id=$3
    AND EXISTS(SELECT 1 FROM af_page_backends p WHERE p.page_id=b.page_id AND p.page_version=b.page_version AND p.file_id=b.backend_id AND p.version=b.backend_version)`,
      [context.backendId, context.backendVersion, context.pageId],
    )
  ).rows;
  if (binding.length !== 1) return null;
  await client.query(
    "SELECT id FROM files WHERE id=$1 AND deleted_at IS NULL FOR SHARE",
    [context.pageId],
  );
  const page = await loadDocumentHeader(client, context.pageId);
  if (!page || page.head !== String(binding[0]!.page_version)) return null;
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
  const saved = (
    await client.query(
      "SELECT legacy_user_id,joined_at FROM dataset_page_joins WHERE page_id=$1 AND source_namespace=$2 ORDER BY joined_at,legacy_user_id LIMIT 10001 FOR SHARE",
      [context.pageId, binding[0]!.source_namespace],
    )
  ).rows;
  if (saved.length > 10000) return null;
  const rows = [];
  for (const row of saved) {
    const at =
      row.joined_at instanceof Date
        ? row.joined_at
        : new Date(String(row.joined_at));
    if (
      row.joined_at == null ||
      !Number.isFinite(at.getTime()) ||
      typeof row.legacy_user_id !== "string" ||
      !row.legacy_user_id
    )
      return null;
    rows.push({ user_id: row.legacy_user_id, joined_at: at.toISOString() });
  }
  return {
    generation: createHash("sha256")
      .update(
        JSON.stringify([
          page.id,
          page.head,
          page.generation,
          page.access,
          rows,
        ]),
      )
      .digest("hex"),
    rows,
  };
}
export function createDatasetMembersRepository(
  database: SqlDatabase,
  now = Date.now,
): DatasetMembersPorts {
  return {
    snapshot: (context) =>
      database.transaction((client) =>
        loadDatasetMembers(client, context, now()),
      ),
  };
}

/** Publication only, inside the caller's canonical backend registration transaction. */
export async function registerDatasetMemberBinding(
  client: Pick<SqlClient, "query">,
  binding: {
    backendId: string;
    backendVersion: string;
    pageId: string;
    pageVersion: number;
    sourceNamespace: string;
  },
): Promise<void> {
  const tuple = [
    binding.backendId,
    binding.backendVersion,
    binding.pageId,
    binding.pageVersion,
  ];
  if (
    !binding.sourceNamespace ||
    !(
      await client.query(
        "SELECT 1 FROM af_page_backends WHERE file_id=$1 AND version=$2 AND page_id=$3 AND page_version=$4",
        tuple,
      )
    ).rows.length
  )
    throw Error("Unregistered membership backend");
  const saved = (
    await client.query(
      "SELECT source_namespace FROM dataset_member_bindings WHERE backend_id=$1 AND backend_version=$2 AND page_id=$3 AND page_version=$4",
      tuple,
    )
  ).rows[0];
  if (saved && saved.source_namespace !== binding.sourceNamespace)
    throw Error("Conflicting membership provenance");
  if (!saved)
    await client.query(
      "INSERT INTO dataset_member_bindings(backend_id,backend_version,page_id,page_version,source_namespace) VALUES($1,$2,$3,$4,$5)",
      [...tuple, binding.sourceNamespace],
    );
}
