import type { SqlDatabase } from "./sql-contracts.ts";
import type {
  HistoricalDatasetReplayPorts,
  HistoricalDatasetSelection,
} from "../datasets/history-contracts.ts";
import type { DatasetObjectStore } from "../datasets/object-store-contracts.ts";
import { createHistoricalDatasetReplay } from "../datasets/history.ts";
import { createDatasetReadRepository } from "./datasets.ts";
import { createDatasetReadService } from "../datasets/service.ts";
/** Exact saved standalone self-read binding, not a historical backend capability. */
export function createHistoricalDatasetReplayRepository(
  database: SqlDatabase,
  objects: DatasetObjectStore,
  now = Date.now,
) {
  const resolve: HistoricalDatasetReplayPorts["resolve"] = async (
    pageId,
    version,
    subject,
  ) =>
    database.transaction(async (client) => {
      const rows = (
        await client.query(
          `SELECT b.backend_id,b.backend_version,b.name,b.dataset_version,b.descriptor,v.catalog,p.snapshot FROM dataset_pages p
   LEFT JOIN dataset_bindings b ON b.page_id=p.page_id AND b.page_version=p.page_version AND b.source_namespace=p.source_namespace AND b.name='data'
   LEFT JOIN dataset_versions v ON v.source_namespace=b.source_namespace AND v.legacy_id=b.dataset_id AND v.version=b.dataset_version
   WHERE p.page_id=$1 AND p.page_version=$2 AND p.snapshot->>'format'='dataset'
   AND p.snapshot->'standaloneDataset'->>'kind'='dataset-self-read-v1'`,
          [pageId, version],
        )
      ).rows;
      if (!rows.length) return null;
      // A recognized page with broken registrations produces an unavailable notice, never source fallback.
      const row = rows[0]!;
      const valid =
        rows.length === 1 &&
        Number(row.dataset_version) === version &&
        (row.descriptor as { mode?: unknown })?.mode === "pinned" &&
        Array.isArray(row.catalog) &&
        !(row.snapshot as { standaloneDataset?: { models?: unknown[] } })
          ?.standaloneDataset?.models?.length;
      if (!valid) return { kind: "unavailable" };
      return {
        kind: "ready",
        context: {
          pageId,
          subject,
          backendId: String(row.backend_id),
          backendVersion: String(row.backend_version),
        },
        binding: "data",
        version,
        tables: row.catalog as { schema: string; name: string }[],
      };
    });
  return createHistoricalDatasetReplay({
    resolve,
    read: async (selection: HistoricalDatasetSelection, table) => {
      const reads = createDatasetReadService({
        ...createDatasetReadRepository(database, now, selection.version),
        read: objects.read,
      });
      return reads.read(
        selection.context,
        {
          binding: selection.binding,
          schema: table.schema,
          table: table.name,
          offset: 0,
          limit: 100,
        },
        AbortSignal.timeout(5000),
      );
    },
  });
}
