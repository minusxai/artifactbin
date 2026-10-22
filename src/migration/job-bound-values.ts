import { legacyDocumentSource } from "./conversion/index.ts";
import { readBoundValueColumnProofs } from "./conversion/compiled/bound-values.ts";
import { boundValueCatalog } from "./datasets/bound-value-catalog.ts";
import { catalogVersion, receiptMap } from "./datasets/catalog.ts";
import { migrationDatasetVersionKey } from "./job-dataset-contracts.ts";
import type { BoundValueColumnProof } from "./conversion/compiled/bound-value-contracts.ts";
import type { MigrationBackendPage } from "./backend-preparation-contracts.ts";
import type { MigrationJobSource } from "./job-contracts.ts";
/** Offline authority proofs derive only from the exact current source and verified immutable catalogs. */
export async function prepareMigrationBoundValues(
  source: MigrationJobSource,
  pages: readonly MigrationBackendPage[],
  issues: Map<string, string[]>,
): Promise<ReadonlyMap<string, readonly BoundValueColumnProof[]>> {
  const proofs = new Map<string, readonly BoundValueColumnProof[]>();
  if (!source.datasets) return proofs;
  const receipts = receiptMap(source.datasets.receipts);
  for (const page of pages) {
    try {
      const artifact = (await source.readArtifact(page.legacyId)).artifacts[0]!;
      const head = page.revisions.find((r) => r.version === artifact.version);
      if (!head) throw Error("Current page revision is unavailable");
      const text = artifact.source?.trim()
        ? artifact.source
        : legacyDocumentSource(artifact.document);
      if (text === null) throw Error("Current page source is unavailable");
      // The reader returns [] before inspecting catalogs when no bound Value exists.
      // Do not impose bound-column catalog requirements on unrelated Imports.
      try {
        if (!readBoundValueColumnProofs(text, []).length) continue;
      } catch {
        // Source-bound declarations require the verified registry constructed below.
      }
      const catalogs = [];
      for (const binding of head.imports) {
        const row = (await source.readArtifact(binding.datasetLegacyId))
          .artifacts[0]!;
        if (row.version !== binding.datasetVersion)
          throw Error("Dataset head changed during bound Value planning");
        catalogs.push(
          boundValueCatalog(
            binding.name,
            row,
            catalogVersion(row, row.id, receipts).tables,
          ),
        );
      }
      const values = readBoundValueColumnProofs(text, catalogs);
      if (values.length)
        proofs.set(
          migrationDatasetVersionKey(page.legacyId, artifact.version),
          values,
        );
    } catch {
      issues.set(page.legacyId, [
        ...(issues.get(page.legacyId) ?? []),
        "Trusted bound Value authority planning failed",
      ]);
    }
  }
  return proofs;
}
