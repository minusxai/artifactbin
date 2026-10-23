import {normalizeLegacySourceOperations} from "./conversion/source-operations.ts";
import type { BoundValueColumnProof } from "./conversion/compiled/bound-value-contracts.ts";
import { migrationDatasetVersionKey } from "./job-dataset-contracts.ts";
import { legacyDocumentSource } from "./conversion/index.ts";
import { extractLegacyMutations } from "./conversion/mutations.ts";
import { catalogVersion, receiptMap } from "./datasets/catalog.ts";
import type { MigrationBackendPage } from "./backend-preparation-contracts.ts";
import type { MigrationJobSource } from "./job-contracts.ts";
import { compileNativeProgramResolver } from "./programs/native-compiler.ts";
/** SQL publication uses current trusted catalogs; historical pages never gain write authority. */
export async function prepareMigrationHeadMutations(
  source: MigrationJobSource,
  pages: readonly MigrationBackendPage[],
  issues: Map<string, string[]>,
  boundValueColumns: ReadonlyMap<
    string,
    readonly BoundValueColumnProof[]
  > = new Map(),
  sourceAdmission: import("./conversion-strategy-contracts.ts").MigrationSourceAdmission = "strict",
): Promise<MigrationBackendPage[]> {
  if (!source.datasets) return [...pages];
  const receipts = receiptMap(source.datasets.receipts);
  const admitted: MigrationBackendPage[] = [];
  for (const page of pages) {
    try {
      const artifact = (await source.readArtifact(page.legacyId)).artifacts[0]!;
      const head = page.revisions.find((r) => r.version === artifact.version)!;
      if (
        artifact.format === "program" &&
        head.runsProgram &&
        !head.imports.length
      ) {
        await compileNativeProgramResolver(String(artifact.source ?? ""));
        admitted.push(page);
        continue;
      }
      const catalogs = [];
      for (const binding of head.imports) {
        const dataset = (await source.readArtifact(binding.datasetLegacyId))
          .artifacts[0]!;
        if (dataset.version !== binding.datasetVersion)
          throw Error("Dataset head changed during preparation");
        const catalog = catalogVersion(dataset, dataset.id, receipts);
        catalogs.push({
          name: binding.name,
          datasetLegacyId: dataset.id,
          tables: catalog.tables,
        });
      }
      const text = artifact.source?.trim()
        ? artifact.source
        : legacyDocumentSource(artifact.document);
      if (text === null) throw Error("Current document source is unavailable");
      const extracted = await extractLegacyMutations(
        sourceAdmission === "offline-prototype" ? normalizeLegacySourceOperations(text,catalogs.map(c=>`ref:${c.datasetLegacyId}`)).source : text,
        catalogs,
        boundValueColumns.get(
          migrationDatasetVersionKey(page.legacyId, artifact.version),
        ),
        sourceAdmission,
      );
      if (extracted.issues.length) {
        issues.set(
          page.legacyId,
          extracted.issues.map((issue) => issue.code),
        );
        continue;
      }
      admitted.push({
        ...page,
        revisions: page.revisions.map((r) =>
          r === head
            ? {
                ...r,
                editId:
                  typeof artifact.edit_id === "string"
                    ? artifact.edit_id
                    : undefined,
                mutations: extracted.mutations,
              }
            : r,
        ),
      });
    } catch {
      issues.set(page.legacyId, [
        "Trusted mutation publication planning failed",
      ]);
    }
  }
  return admitted;
}
