import { destinationSchemas } from "./destination-schema.ts";
import { readPartRows } from "./stream.ts";
import { requireMigrationEquality } from "./verification-values.ts";
import type { SqlReader, LegacyRow } from "./contracts.ts";
import type {
  MigrationArchiveSource,
  MigrationArchiveVerification,
} from "./archive-contracts.ts";
/** Re-read original bytes and actual JSONB rows; durable receipts alone are not verification. */
export async function verifyMigrationArchives(
  db: SqlReader,
  schema: string,
  sources: readonly MigrationArchiveSource[],
): Promise<MigrationArchiveVerification> {
  const names = destinationSchemas(schema);
  const totals = { manifests: 0, parts: 0, rows: 0, bytes: 0 };
  for (const source of sources) {
    const stored = (
      await db.query(
        `SELECT kind,digest,manifest FROM ${names.archive}.stream_manifests WHERE namespace=$1`,
        [source.namespace],
      )
    ).rows;
    requireMigrationEquality(
      stored,
      [
        {
          kind: source.kind,
          digest: source.manifestSha256,
          manifest: source.originalManifest,
        },
      ],
      "archive manifest provenance",
    );
    totals.manifests++;
    const expectedRows = source.manifest.parts.reduce((n, p) => n + p.rows, 0);
    requireMigrationEquality(
      (
        await db.query(
          `SELECT count(*)::text AS count FROM ${names.archive}.stream_rows WHERE namespace=$1`,
          [source.namespace],
        )
      ).rows,
      [{ count: String(expectedRows) }],
      "raw namespace row count",
    );
    const parts = (
      await db.query(
        `SELECT path,source_table,digest,rows::text,bytes::text FROM ${names.archive}.stream_parts WHERE namespace=$1 ORDER BY path`,
        [source.namespace],
      )
    ).rows;
    const comparePath = (a: Record<string, unknown>, b: Record<string, unknown>) => String(a.path) < String(b.path) ? -1 : String(a.path) > String(b.path) ? 1 : 0;
    parts.sort(comparePath);
    const expected = source.manifest.parts
      .map((p) => ({
        path: p.path,
        source_table: p.table,
        digest: p.sha256,
        rows: String(p.rows),
        bytes: String(p.bytes),
      }))
      .sort(comparePath);
    requireMigrationEquality(parts, expected, "archive part inventory");
    for (const part of source.manifest.parts) {
      let ordinal = 0,
        batch: LegacyRow[] = [];
      for await (const record of readPartRows(source.directory, part)) {
        if (!batch.length)
          batch = (
            await db.query(
              `SELECT ordinal::text,record FROM ${names.archive}.stream_rows WHERE namespace=$1 AND path=$2 AND ordinal >= $3 ORDER BY stream_rows.ordinal LIMIT 20`,
              [source.namespace, part.path, ordinal],
            )
          ).rows;
        const actual = batch.shift();
        if (!actual || actual.ordinal !== String(ordinal))
          throw Error(
            "Migration verification failed: raw row ordinal mismatch",
          );
        requireMigrationEquality(actual.record, record, "raw row mismatch");
        ordinal++;
      }
      if (
        batch.length ||
        (
          await db.query(
            `SELECT 1 FROM ${names.archive}.stream_rows WHERE namespace=$1 AND path=$2 AND ordinal >= $3 LIMIT 1`,
            [source.namespace, part.path, ordinal],
          )
        ).rows.length
      )
        throw Error("Migration verification failed: extra raw rows");
      if (ordinal !== part.rows)
        throw Error("Migration verification failed: raw row count mismatch");
      totals.parts++;
      totals.rows += ordinal;
      totals.bytes += part.bytes;
    }
  }
  return totals;
}
