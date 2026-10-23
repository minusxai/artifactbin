import type { SqlDatabase } from "./sql-contracts.ts";
import type { LegacyViewerBindingPort } from "../backend/legacy-viewer-contracts.ts";
export function createLegacyViewerBindingRepository(
  database: SqlDatabase,
): LegacyViewerBindingPort {
  return {
    current: (context, signal) =>
      database.transaction(
        async (client) => {
          const { rows } = await client.query(
            `SELECT b.source_namespace FROM dataset_viewer_bindings b
      JOIN files f ON f.id=b.page_id AND f.head=b.page_version::text AND f.deleted_at IS NULL
      JOIN af_backend_pages a ON a.page_id=b.page_id AND a.page_version=b.page_version
      JOIN af_page_backends p ON p.page_id=b.page_id AND p.page_version=b.page_version AND p.file_id=b.backend_id AND p.version=b.backend_version
      WHERE b.backend_id=$1 AND b.backend_version=$2 AND b.page_id=$3`,
            [context.backendId, context.backendVersion, context.pageId],
          );
          return rows.length === 1;
        },
        { signal, timeoutMs: 1000 },
      ),
  };
}
