import type { SqlDatabase } from "./sql.ts";
import type { LiveInvalidationReader } from "../live-invalidation-contracts.ts";
/** Only live bindings belonging to the current active page/backend revision receive data invalidations. */
export function createDatasetInvalidationReader(
  database: SqlDatabase,
): LiveInvalidationReader {
  return {
    after(sequence, limit) {
      if (
        !/^(0|[1-9][0-9]*)$/.test(sequence) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 128
      )
        throw Error("Invalid invalidation cursor");
      return database.transaction(async (client) => {
        const { rows } = await client.query(
          `WITH changes AS (
    SELECT sequence,source_namespace,dataset_id FROM dataset_invalidations WHERE sequence>$1::bigint ORDER BY sequence LIMIT $2
   ) SELECT i.sequence,ARRAY_REMOVE(ARRAY_AGG(DISTINCT b.page_id),NULL) AS pages FROM changes i
   LEFT JOIN dataset_bindings b ON b.source_namespace=i.source_namespace AND b.dataset_id=i.dataset_id
    AND b.descriptor->>'mode'='live'
    AND EXISTS(SELECT 1 FROM files f WHERE f.id=b.page_id AND f.head=b.page_version::text AND f.deleted_at IS NULL)
    AND EXISTS(SELECT 1 FROM af_page_backends p WHERE p.page_id=b.page_id AND p.page_version=b.page_version AND p.file_id=b.backend_id AND p.version=b.backend_version)
   GROUP BY i.sequence ORDER BY i.sequence`,
          [sequence, limit],
        );
        return rows.map((row) => ({
          sequence: String(row.sequence),
          pageIds: row.pages as string[],
        }));
      });
    },
  };
}
