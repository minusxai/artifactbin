import type { SqlClient } from "./sql.ts";
import type { DocumentSnapshot } from "../datasets/policy/contracts.ts";
import type {
  MigratedDatasetLifecycleProjection,
  ProjectMigratedDatasetLifecycle,
} from "../datasets/migrated-lifecycle-contracts.ts";
const validSha = (value: string) => /^[a-f0-9]{64}$/.test(value);
/** Imported snapshots stay immutable; only an exact migration link supplies current lifecycle. */
export const projectMigratedDatasetLifecycle: ProjectMigratedDatasetLifecycle =
  (snapshot, expected, current) => {
    if (
      !current ||
      current.link.sourceNamespace !== expected.sourceNamespace ||
      current.link.pageId !== expected.pageId ||
      current.link.legacyId !== snapshot.id ||
      current.snapshotId !== snapshot.id ||
      current.owner !== expected.owner ||
      current.fileOwner !== expected.owner ||
      !validSha(current.link.authoritySha256)
    )
      return snapshot;
    return { ...snapshot, deleted: current.deleted };
  };
async function linksAvailable(
  client: SqlClient,
  resource = false,
): Promise<boolean> {
  const row = (
    await client.query(
      "SELECT to_regclass(format('%I.dataset_deleted_page_lifecycle_links',current_schema())) AS pages,to_regclass(format('%I.dataset_deleted_lifecycle_links',current_schema())) AS resources",
    )
  ).rows[0];
  return Boolean(row?.pages && (!resource || row.resources));
}
/** Called with file locks in the same transaction. A lifecycle transition advances the
 * resource generation so cached reads and staged writes cannot cross delete/restore.
 * Policy revision stays unchanged because ACL and policy do not change. */
export async function syncMigratedDatasetLifecycle(
  client: SqlClient,
  owner: string,
  pageIds: readonly string[],
): Promise<void> {
  if (!pageIds.length || !(await linksAvailable(client, true))) return;
  const rows = (
    await client.query(
      `SELECT l.source_namespace,l.legacy_id,l.page_id,l.authority_sha256,p.authority_sha256 AS page_authority,p.source_namespace AS page_namespace,p.legacy_id AS page_legacy,
 f.owner AS file_owner,f.deleted_at,r.owner AS resource_owner,r.snapshot->>'id' AS snapshot_id
 FROM dataset_deleted_lifecycle_links l JOIN dataset_deleted_page_lifecycle_links p ON p.page_id=l.page_id
 JOIN files f ON f.id=l.page_id JOIN dataset_resources r ON r.source_namespace=l.source_namespace AND r.legacy_id=l.legacy_id
 WHERE l.page_id=ANY($1::text[]) ORDER BY l.page_id FOR UPDATE OF r`,
      [pageIds],
    )
  ).rows;
  for (const row of rows) {
    if (
      row.page_namespace !== row.source_namespace ||
      row.page_legacy !== row.legacy_id ||
      row.file_owner !== owner ||
      row.resource_owner !== owner ||
      row.snapshot_id !== row.legacy_id ||
      row.authority_sha256 !== row.page_authority ||
      !validSha(String(row.authority_sha256))
    )
      throw Error("Migrated dataset lifecycle authority mismatch");
    await client.query(
      "UPDATE dataset_resources SET deleted=$3,generation=generation+1 WHERE source_namespace=$1 AND legacy_id=$2 AND owner=$4 AND deleted IS DISTINCT FROM $3",
      [row.source_namespace, row.legacy_id, row.deleted_at !== null, owner],
    );
  }
}
/** Read and write authority share this projection after current page ACL authorization. */
export async function projectCurrentMigratedDatasetPage(
  client: SqlClient,
  snapshot: DocumentSnapshot,
  expected: { sourceNamespace: string; pageId: string; owner: string },
): Promise<DocumentSnapshot> {
  if (!(await linksAvailable(client))) return snapshot;
  const rows = (
    await client.query(
      `SELECT l.source_namespace,l.legacy_id,l.page_id,l.authority_sha256,f.owner,f.deleted_at
 FROM dataset_deleted_page_lifecycle_links l JOIN files f ON f.id=l.page_id
 WHERE l.source_namespace=$1 AND l.legacy_id=$2 AND l.page_id=$3`,
      [expected.sourceNamespace, snapshot.id, expected.pageId],
    )
  ).rows;
  if (rows.length !== 1) return snapshot;
  const row = rows[0]!;
  const current: MigratedDatasetLifecycleProjection = {
    link: {
      sourceNamespace: String(row.source_namespace),
      legacyId: String(row.legacy_id),
      pageId: String(row.page_id),
      authoritySha256: String(row.authority_sha256),
    },
    owner: String(row.owner),
    fileOwner: String(row.owner),
    snapshotId: String(row.legacy_id),
    deleted: row.deleted_at !== null,
  };
  return projectMigratedDatasetLifecycle(snapshot, expected, current);
}
