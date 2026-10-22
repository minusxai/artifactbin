import { projectMigrationOwnershipDatasetGrants } from "./ownership-dataset-grants.ts";
import { migrationPageQueryRegistrations } from "./query-registrations.ts";
import type { MigrationSavedQueryRegistration } from "./query-registrations.ts";
import { writeFile } from "node:fs/promises";
import { readMigrationArchiveSources } from "./archive-sources.ts";
import { verifyMigrationArchives } from "./archive-verification.ts";
import { verifyMigrationRuntime } from "./page-verification.ts";
import { verifyMigrationAuthority } from "./authority-verification.ts";
import { verifyMigrationDatasetMetadata } from "./dataset-verification.ts";
import { selectMigrationDatasetMetadata } from "./dataset-selection.ts";
import { readPreparedMigrationPages } from "./prepared-pages.ts";
import type { SqlReader } from "./contracts.ts";
import type {
  MigrationJobOptions,
  MigrationJobSource,
  MigrationJobPlan,
  MigrationPagePlanner,
} from "./job-contracts.ts";
import type { PlannedPage } from "./contracts.ts";

interface PreparedMigrationVerificationPages {
  pages: AsyncIterable<PlannedPage>;
  queryRegistrations: MigrationSavedQueryRegistration[];
}

/** Collect registrations as runtime verification consumes the prepared source once. */
export function prepareMigrationVerificationPages(
  sourcePages: AsyncIterable<PlannedPage>,
  sourceNamespace: string,
  origin: string,
): PreparedMigrationVerificationPages {
  const queryRegistrations: MigrationSavedQueryRegistration[] = [];
  async function* pages(): AsyncGenerator<PlannedPage> {
    for await (const page of sourcePages) {
      queryRegistrations.push(
        ...migrationPageQueryRegistrations(page, sourceNamespace, origin),
      );
      yield page;
    }
  }
  return { pages: pages(), queryRegistrations };
}
/** Independent destination reads in one repeatable-read READ ONLY transaction. Never repairs missing data. */
export async function verifyMigrationJob(
  source: MigrationJobSource,
  options: MigrationJobOptions,
  planned: MigrationJobPlan,
  planner: MigrationPagePlanner,
  db: SqlReader,
) {
  const archives = await readMigrationArchiveSources({
    baseDirectory: options.sourceDirectory,
    relationDirectory: source.datasets
      ? options.datasets?.relationDirectory
      : undefined,
  });
  const ready = new Set(planned.readiness.ready);
  await db.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  let result;
  try {
    const raw = await verifyMigrationArchives(db, options.schema, archives);
    const preparedPages = prepareMigrationVerificationPages(
      readPreparedMigrationPages(source, options, planned, planner),
      source.manifest.sourceNamespace,
      options.origin,
    );
    const runtime = await verifyMigrationRuntime(db, options.schema, {
      pages: preparedPages.pages,
      maps: options.standaloneVizPages ? {...source.maps,pages:Object.fromEntries(options.standaloneVizPages.admission.heads.map(h=>[h.legacyId,h.pageId]))} : options.standaloneDatasetPages ? {...source.maps,pages:Object.fromEntries(options.standaloneDatasetPages.heads.map(h=>[h.legacyId,source.maps.pages[h.legacyId]!]))} : source.maps,
      origin: options.origin,
    });
    const actors = await verifyMigrationAuthority(
      db,
      options.schema,
      source.base,
      source.maps,
    );
    const queryRegistrations = preparedPages.queryRegistrations;
    const datasetRows =
      source.preparedDatasets && source.datasets
        ? await verifyMigrationDatasetMetadata(
            db,
            options.schema,
            {
              ...source.datasets.provenance,
              ...(options.standaloneDatasetPages ? {additive:options.standaloneDatasetPages} : {}),
              profileAssets: source.supplementalAssets?.profiles,
              queryRegistrations,
              ...(source.preparedDatasets.sourceQueryRegistrations?.length
                ? {
                    sourceQueryRegistrations:
                      source.preparedDatasets.sourceQueryRegistrations.filter(
                        (g) => ready.has(g.receipt.pageId),
                      ),
                  }
                : {}),
              ...projectMigrationOwnershipDatasetGrants(
                selectMigrationDatasetMetadata(
                  source.preparedDatasets.metadata,
                  ready,
                ),
                source.preparedDatasets.ownershipDatasetGrants,
                options.standaloneDatasetPages ? undefined : options.ownershipOverride,
              ),
            },
            options.ownershipOverride,
            options.sourceQueryRegistrations,
          )
        : 0;
    result = {
      complete: true,
      readOnly: true,
      raw,
      runtime,
      actors,
      datasetRows,
      compilerIdentity: planned.compilerIdentity,
      archives: archives.map((s) => ({
        kind: s.kind,
        manifestSha256: s.manifestSha256,
        exportedAt: s.manifest.exportedAt,
      })),
    };
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
  await writeFile(
    options.reportPath + ".verification.json",
    JSON.stringify(result),
    { flag: "wx", mode: 0o600 },
  );
  return result;
}
