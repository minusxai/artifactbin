import { assertDeletedMigrationPublication } from "./inactive-publication.ts";
import { FILE_ID_PATTERN } from "../af-contracts.ts";
import type { SqlReader } from "./contracts.ts";
import type { MigrationViewerBinding } from "./viewer-binding-contracts.ts";
/** Called inside the page/backend transaction; a browser cannot choose the namespace or source subject. */
export async function registerMigrationViewerBinding(
  db: SqlReader,
  binding: MigrationViewerBinding,
): Promise<void> {
  if (
    !FILE_ID_PATTERN.test(binding.backendId) ||
    !FILE_ID_PATTERN.test(binding.pageId) ||
    !binding.backendVersion ||
    !Number.isSafeInteger(binding.pageVersion) ||
    binding.pageVersion < 1 ||
    !binding.sourceNamespace
  )
    throw Error("Invalid viewer binding provenance");
  const tuple = [
    binding.backendId,
    binding.backendVersion,
    binding.pageId,
    binding.pageVersion,
  ];
  if (
    !(
      await db.query(
        "SELECT 1 FROM af_page_backends p JOIN files f ON f.id=p.page_id AND f.head=p.page_version::text AND f.deleted_at IS NULL WHERE p.file_id=$1 AND p.version=$2 AND p.page_id=$3 AND p.page_version=$4",
        [...tuple],
      )
    ).rows.length
  )
    throw Error("Unregistered current viewer backend");
  await saveViewerBinding(db, binding, tuple);
}
/** Offline-only deleted publication; runtime viewer resolution still requires a live head. */
export async function registerInactiveMigrationViewerBinding(
  db: SqlReader,
  binding: MigrationViewerBinding,
  publication: import("./inactive-publication-contracts.ts").DeletedMigrationPublicationContext,
): Promise<void> {
  await assertDeletedMigrationPublication(db, publication, binding);
  await saveViewerBinding(db, binding, [
    binding.backendId,
    binding.backendVersion,
    binding.pageId,
    binding.pageVersion,
  ]);
}
async function saveViewerBinding(
  db: SqlReader,
  binding: MigrationViewerBinding,
  tuple: readonly unknown[],
): Promise<void> {
  const saved = (
    await db.query(
      "SELECT source_namespace FROM dataset_viewer_bindings WHERE backend_id=$1 AND backend_version=$2 AND page_id=$3 AND page_version=$4",
      [...tuple],
    )
  ).rows[0];
  if (saved && saved.source_namespace !== binding.sourceNamespace)
    throw Error("Conflicting viewer provenance");
  if (!saved)
    await db.query(
      "INSERT INTO dataset_viewer_bindings(backend_id,backend_version,page_id,page_version,source_namespace) VALUES($1,$2,$3,$4,$5)",
      [...tuple, binding.sourceNamespace],
    );
}
