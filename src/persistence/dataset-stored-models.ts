import type { SqlDatabase } from "./sql-contracts.ts";
import type { StoredModelPorts } from "../datasets/stored-model/contracts.ts";
import { resolveStoredModelRegistration } from "../datasets/stored-model/registration.ts";
/** Lookup is scoped to the current saved page head, exact backend binding and original source version. */
export function createStoredModelResolver(
  database: SqlDatabase,
): StoredModelPorts["resolve"] {
  return (context, binding, table, signal) =>
    database.transaction(
      async (client) => {
        const rows = (
          await client.query(
            `SELECT p.snapshot,v.source_catalog FROM dataset_bindings b
JOIN files f ON f.id=b.page_id AND f.head=b.page_version::text
JOIN af_page_backends a ON a.page_id=b.page_id AND a.page_version=b.page_version AND a.file_id=b.backend_id AND a.version=b.backend_version
JOIN dataset_pages p ON p.page_id=b.page_id AND p.page_version=b.page_version AND p.source_namespace=b.source_namespace
JOIN dataset_versions v ON v.source_namespace=b.source_namespace AND v.legacy_id=b.dataset_id AND v.version=$6
WHERE b.backend_id=$1 AND b.backend_version=$2 AND b.page_id=$3 AND b.name=$4 AND b.page_version=$5 AND b.dataset_id=$7 AND b.dataset_version=$8`,
            [
              context.backendId,
              context.backendVersion,
              context.pageId,
              binding.name,
              binding.page.version,
              binding.revision.version,
              binding.dataset.id,
              binding.dataset.version,
            ],
          )
        ).rows;
        if (rows.length !== 1) return null;
        return resolveStoredModelRegistration(
          binding,
          table,
          rows[0]!.snapshot,
          rows[0]!.source_catalog,
        );
      },
      signal ? { signal, timeoutMs: 1000 } : undefined,
    );
}
