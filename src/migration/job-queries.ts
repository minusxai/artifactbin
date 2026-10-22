import { hasLegacyServerModule } from "./query-source.ts";
import { legacyDocumentSource } from "./conversion/index.ts";
import { prepareMigrationQueryReceipt } from "./query-preparation.ts";
import { migrationDatasetVersionKey } from "./job-dataset-contracts.ts";
import type { MigrationJobDatasets } from "./job-dataset-contracts.ts";
import type { MigrationQueryCompiler } from "./query-preparation-contracts.ts";
import type { PlannedPage } from "./contracts.ts";
/** Current source registration only: unavailable historical authority is never replaced with head facts. */
export async function prepareMigrationPageQueries(
  pages: readonly PlannedPage[],
  datasets: MigrationJobDatasets | undefined,
  queries?: { compiler: MigrationQueryCompiler; compilerIdentity: string },
): Promise<void> {
  for (const page of pages) {
    const raw = page.original;
    let text =
      typeof raw.source === "string" && raw.source.trim()
        ? raw.source
        : typeof raw.markup === "string" && raw.markup.trim()
          ? raw.markup
          : null;
    if (text === null && raw.document)
      try {
        text = legacyDocumentSource(raw.document);
      } catch {
        /* Existing conversion reports malformed documents. */
      }
    if (!text || !hasLegacyServerModule(text)) continue;
    try {
      if (
        !queries ||
        !page.backends?.some(
          (b) => b.pageVersion === raw.version && b.linked,
        ) ||
        !datasets?.metadata.pages.some(
          (p) => p.pageId === page.pageId && p.pageVersion === raw.version,
        )
      )
        throw Error("query_registration_saved_binding_unavailable");
      const receipt = await prepareMigrationQueryReceipt(
        {
          source: text,
          version: raw.version,
          bindings:
            datasets.bindings.get(
              migrationDatasetVersionKey(page.legacyId, raw.version),
            ) ?? [],
          compilerIdentity: queries.compilerIdentity,
        },
        queries.compiler,
      );
      if (!receipt) throw Error("query_server_module_missing");
      page.serverQueries = [receipt];
    } catch {
      page.disposition = "blocked";
      page.issues.push("query_registration_unavailable");
    }
  }
}
