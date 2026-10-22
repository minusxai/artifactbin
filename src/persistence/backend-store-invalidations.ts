import type { SqlDatabase } from "./sql.ts";
import type { LiveInvalidationReader } from "../live-invalidation-contracts.ts";
/** A backend file store is shared by all its deployment versions and current linked pages. */
export function createBackendStoreInvalidationReader(
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
    SELECT sequence,backend_id FROM backend_store_invalidations WHERE sequence>$1::bigint ORDER BY sequence LIMIT $2
   ) SELECT i.sequence,ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.page_id),NULL) AS pages FROM changes i
   LEFT JOIN af_page_backends p ON p.file_id=i.backend_id
    AND EXISTS(SELECT 1 FROM files f WHERE f.id=p.page_id AND f.head=p.page_version::text AND f.deleted_at IS NULL)
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
