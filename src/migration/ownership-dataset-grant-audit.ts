import type { SqlReader } from "./contracts.ts";
import type { MigrationOwnershipDatasetGrantAudit } from "./ownership-dataset-grants-contracts.ts";
import { canonicalMigrationValue as canonical } from "./verification-values.ts";
/** Called inside the metadata transaction; retries compare rather than restoring missing audit. */
export async function persistMigrationOwnershipDatasetGrantAudit(
  db: SqlReader,
  archive: string,
  namespace: string,
  audits: readonly MigrationOwnershipDatasetGrantAudit[],
  replay: boolean,
): Promise<void> {
  if (!audits.length) return;
  await db.query(
    `CREATE TABLE IF NOT EXISTS ${archive}.ownership_dataset_grants (source_namespace text NOT NULL,dataset_id text NOT NULL,audit jsonb NOT NULL,PRIMARY KEY(source_namespace,dataset_id))`,
  );
  const rows = (
    await db.query(
      `SELECT dataset_id,audit FROM ${archive}.ownership_dataset_grants WHERE source_namespace=$1 ORDER BY dataset_id`,
      [namespace],
    )
  ).rows;
  const expected = new Map(audits.map((a) => [a.datasetLegacyId, a]));
  for (const row of rows)
    if (
      canonical(expected.get(String(row.dataset_id))) !== canonical(row.audit)
    )
      throw Error("Ownership dataset grant audit differs");
  for (const audit of audits) {
    const row = rows.find((r) => r.dataset_id === audit.datasetLegacyId);
    if (!row) {
      if (replay)
        throw Error("Ownership dataset grant audit was removed after import");
      await db.query(
        `INSERT INTO ${archive}.ownership_dataset_grants VALUES ($1,$2,$3::jsonb)`,
        [namespace, audit.datasetLegacyId, JSON.stringify(audit)],
      );
    }
  }
}
export async function verifyMigrationOwnershipDatasetGrantAudit(
  db: SqlReader,
  archive: string,
  namespace: string,
  audits: readonly MigrationOwnershipDatasetGrantAudit[],
): Promise<number> {
  if (!audits.length) return 0;
  const rows = (
    await db.query(
      `SELECT dataset_id,audit FROM ${archive}.ownership_dataset_grants WHERE source_namespace=$1 ORDER BY dataset_id`,
      [namespace],
    )
  ).rows;
  const expected = audits
    .map((a) => ({ dataset_id: a.datasetLegacyId, audit: a }))
    .sort((a, b) => a.dataset_id.localeCompare(b.dataset_id));
  if (canonical(rows) !== canonical(expected))
    throw Error("Ownership dataset grant independent audit differs");
  return rows.length;
}
