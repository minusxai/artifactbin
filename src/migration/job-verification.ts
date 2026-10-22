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
    const runtime = await verifyMigrationRuntime(db, options.schema, {
      pages: readPreparedMigrationPages(source, options, planned, planner),
      maps: source.maps,
      origin: options.origin,
    });
    const actors = await verifyMigrationAuthority(
      db,
      options.schema,
      source.base,
      source.maps,
    );
    const queryRegistrations: MigrationSavedQueryRegistration[] = [];
    for await (const page of readPreparedMigrationPages(
      source,
      options,
      planned,
      planner,
    ))
      queryRegistrations.push(
        ...migrationPageQueryRegistrations(
          page,
          source.manifest.sourceNamespace,
          options.origin,
        ),
      );
    const datasetRows =
      source.preparedDatasets && source.datasets
        ? await verifyMigrationDatasetMetadata(
            db,
            options.schema,
            {
              ...source.datasets.provenance,
              profileAssets: source.supplementalAssets?.profiles,
              queryRegistrations,
              ...projectMigrationOwnershipDatasetGrants(
                selectMigrationDatasetMetadata(
                  source.preparedDatasets.metadata,
                  ready,
                ),
                source.preparedDatasets.ownershipDatasetGrants,
                options.ownershipOverride,
              ),
            },
            options.ownershipOverride,
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
