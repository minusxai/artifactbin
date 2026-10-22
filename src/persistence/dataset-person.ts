import type { SqlDatabase } from "./sql-contracts.ts";
import type {
  DatasetPersonPorts,
  DatasetPersonBinding,
} from "../datasets/person-contracts.ts";
/** Both registry and card tables are internal; every disclosure is gated by the read service. */
export function createDatasetPersonRepository(
  database: SqlDatabase,
): Pick<DatasetPersonPorts, "binding" | "card"> {
  return {
    binding: (context, valueName) =>
      database.transaction(async (client) => {
        const row = (
          await client.query(
            `SELECT b.* FROM dataset_person_bindings b
    JOIN dataset_bindings d ON d.backend_id=b.backend_id AND d.backend_version=b.backend_version AND d.page_id=b.page_id AND d.page_version=b.page_version AND d.source_namespace=b.source_namespace AND d.name=b.descriptor->>'bindingName'
    JOIN files f ON f.id=b.page_id AND f.head=b.page_version::text AND f.deleted_at IS NULL
    WHERE b.backend_id=$1 AND b.backend_version=$2 AND b.page_id=$3 AND b.value_name=$4
    AND EXISTS(SELECT 1 FROM af_page_backends p WHERE p.file_id=b.backend_id AND p.version=b.backend_version AND p.page_id=b.page_id AND p.page_version=b.page_version)`,
            [
              context.backendId,
              context.backendVersion,
              context.pageId,
              valueName,
            ],
          )
        ).rows[0];
        if (!row) return null;
        const descriptor = row.descriptor as DatasetPersonBinding;
        if (
          descriptor.sourceNamespace !== row.source_namespace ||
          descriptor.backendId !== context.backendId ||
          descriptor.backendVersion !== context.backendVersion ||
          descriptor.pageId !== context.pageId ||
          descriptor.pageVersion !== Number(row.page_version) ||
          descriptor.valueName !== valueName
        )
          return null;
        return descriptor;
      }),
    card: (namespace, userId) =>
      database.transaction(async (client) => {
        const row = (
          await client.query(
            "SELECT name,handle,image FROM dataset_public_profiles WHERE source_namespace=$1 AND legacy_user_id=$2",
            [namespace, userId],
          )
        ).rows[0];
        return row
          ? {
              name: String(row.name),
              handle: row.handle == null ? null : String(row.handle),
              image: row.image == null ? null : String(row.image),
            }
          : null;
      }),
  };
}
