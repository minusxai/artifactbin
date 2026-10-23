import { destinationSchemas } from "./destination-schema.ts";
import type { LegacyRow, SqlReader } from "./contracts.ts";
export interface MigrationArchivedArtifact {
  digest: string;
  maps: unknown;
  original: LegacyRow;
}
/** Read one original head from its inline projection or authenticated raw stream part. */
export async function readMigrationArchivedArtifact(
  db: SqlReader,
  schema: string,
  namespace: string,
  legacyId: string,
): Promise<MigrationArchivedArtifact> {
  const { archive } = destinationSchemas(schema);
  const saved = (
    await db.query(
      `SELECT digest,maps,(SELECT value FROM jsonb_array_elements(manifest->'artifacts') WHERE value->>'id'=$2) AS original FROM ${archive}.archives WHERE namespace=$1`,
      [namespace, legacyId],
    )
  ).rows;
  if (saved.length !== 1)
    throw Error("Migration archive namespace unavailable");
  const stored = saved[0]!;
  if (stored.original)
    return {
      digest: String(stored.digest),
      maps: stored.maps,
      original: stored.original as LegacyRow,
    };
  const rows = (
    await db.query(
      `SELECT r.record AS original,r.ordinal::text,p.path,p.source_table,p.digest AS part_digest,p.rows::text AS part_rows,p.bytes::text AS part_bytes,m.kind,m.digest AS manifest_digest,m.manifest->>'sourceNamespace' AS source_namespace,(SELECT value FROM jsonb_array_elements(m.manifest->'parts') WHERE value->>'path'=p.path) AS part FROM ${archive}.stream_parts p JOIN ${archive}.stream_rows r ON r.namespace=p.namespace AND r.path=p.path JOIN ${archive}.stream_manifests m ON m.namespace=p.namespace WHERE p.namespace=$1 AND p.source_table='artifacts' AND r.record->>'id'=$2 LIMIT 2`,
      [namespace, legacyId],
    )
  ).rows;
  if (rows.length !== 1)
    throw Error("Migration raw artifact unavailable or ambiguous");
  const row = rows[0]!,
    part = row.part as Record<string, unknown> | undefined,
    original = row.original as LegacyRow | undefined;
  const count = Number(row.part_rows),
    bytes = Number(row.part_bytes),
    ordinal = Number(row.ordinal);
  if (
    row.kind !== "base" ||
    row.source_namespace !== namespace ||
    !/^([a-f0-9]{64})$/.test(String(row.manifest_digest)) ||
    row.source_table !== "artifacts" ||
    !original ||
    original.id !== legacyId ||
    !part ||
    part.table !== "artifacts" ||
    part.path !== row.path ||
    part.sha256 !== row.part_digest ||
    !/^[a-f0-9]{64}$/.test(String(row.part_digest)) ||
    part.rows !== count ||
    part.bytes !== bytes ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    !Number.isSafeInteger(bytes) ||
    bytes < 1 ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < 0 ||
    ordinal >= count
  )
    throw Error("Migration raw artifact part authority differs");
  return { digest: String(stored.digest), maps: stored.maps, original };
}
