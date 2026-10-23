import { assertHistoricalSourceQueryAuthority } from "../datasets/source-query/historical-authority.ts";
import { destinationSchemas } from "./destination-schema.ts";
import type { SqlReader } from "./contracts.ts";
import type { DatasetMigrationBatch } from "./dataset-destination-contracts.ts";
import type { MigrationSourceQueryBatch } from "./source-query-contracts.ts";
/** Publication/verification only: a saved query never borrows a current viewer binding. */
export async function verifyMigrationSourceQueryAuthority(
  db: SqlReader,
  schema: string,
  batch: DatasetMigrationBatch,
  group: MigrationSourceQueryBatch,
): Promise<void> {
  const { runtime } = destinationSchemas(schema),
    r = group.receipt,
    h = r.historicalSourceQueries;
  if (h) {
    assertHistoricalSourceQueryAuthority(h, {
      ...r,
      sourceNamespace: batch.metadata.sourceNamespace,
    });
    const page = batch.metadata.pages.find(
      (p) => p.pageId === r.pageId && p.pageVersion === r.pageVersion,
    );
    const head = Math.max(
      ...batch.metadata.pages
        .filter((p) => p.pageId === r.pageId)
        .map((p) => p.pageVersion),
    );
    const admitted =
      batch.additive?.history?.revisions.find(
        (p) => p.legacyId === r.pageLegacyId && p.version === r.pageVersion,
      ) ??
      batch.deletedAdditive?.admitted.find(
        (p) =>
          p.legacyId === r.pageLegacyId &&
          p.pageId === r.pageId &&
          p.version === r.pageVersion,
      );
    if (
      !page ||
      page.snapshot.format !== "dataset" ||
      page.snapshot.id !== h.pageLegacyId ||
      page.snapshot.editId !== h.editId ||
      head !== h.headVersion ||
      !admitted ||
      admitted.artifactSha256 !== h.artifactSha256
    )
      throw Error(
        "Historical source query differs from original saved authority",
      );
  }
  const authority = await db.query(
    h
      ? `SELECT 1 FROM ${runtime}.af_backend_versions v JOIN ${runtime}.af_page_backends p ON p.file_id=v.file_id AND p.version=v.version JOIN ${runtime}.files f ON f.id=p.page_id JOIN ${runtime}.af_backend_files b ON b.file_id=v.file_id AND b.owner=f.owner WHERE v.file_id=$1 AND v.version=$2 AND p.page_id=$3 AND p.page_version=$4 AND v.page_id=p.page_id AND v.page_version=p.page_version AND f.head=$5`
      : `SELECT 1 FROM ${runtime}.af_backend_versions v JOIN ${runtime}.af_page_backends p ON p.file_id=v.file_id AND p.version=v.version JOIN ${runtime}.dataset_viewer_bindings b ON b.backend_id=v.file_id AND b.backend_version=v.version AND b.page_id=p.page_id AND b.page_version=p.page_version WHERE v.file_id=$1 AND v.version=$2 AND p.page_id=$3 AND p.page_version=$4 AND b.source_namespace=$5`,
    [
      r.backendId,
      r.deployment.version,
      r.pageId,
      r.pageVersion,
      h ? String(h.headVersion) : batch.metadata.sourceNamespace,
    ],
  );
  if (authority.rows.length !== 1)
    throw Error(
      "Source query requires exact compiled backend/page/viewer authority",
    );
}
