import { writeFile } from "node:fs/promises";
import { readMigrationArchiveSources } from "./archive-sources.ts";
import { verifyMigrationArchives } from "./archive-verification.ts";
import { verifyMigrationRuntime } from "./page-verification.ts";
import { verifyMigrationAuthority } from "./authority-verification.ts";
import { verifyMigrationDatasetMetadata } from "./dataset-verification.ts";
import { selectMigrationDatasetMetadata } from "./dataset-selection.ts";
import { migrationPageDigest } from "./import.ts";
import { rewriteMigrationLinks } from "./links.ts";
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
  async function* pages() {
    for (const id of source.ids) {
      if (!ready.has(source.maps.pages[id]!)) continue;
      const plan = await planner(await source.readArtifact(id));
      for (const page of plan.pages) {
        if (migrationPageDigest(page) !== planned.pageDigests.get(page.pageId))
          throw Error("Verification source plan changed");
        for (const revision of page.revisions)
          if (revision.conversion.html !== null)
            revision.conversion.html = rewriteMigrationLinks(
              revision.conversion.html,
              source.maps,
              {
                legacyOrigins: options.legacyOrigins,
                targetOrigin: options.origin,
                readyPages: ready,
              },
            );
        yield page;
      }
    }
  }
  await db.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  let result;
  try {
    const raw = await verifyMigrationArchives(db, options.schema, archives);
    const runtime = await verifyMigrationRuntime(db, options.schema, {
      pages: pages(),
      maps: source.maps,
      origin: options.origin,
    });
    const actors = await verifyMigrationAuthority(
      db,
      options.schema,
      source.base,
      source.maps,
    );
    const datasetRows =
      source.preparedDatasets && source.datasets
        ? await verifyMigrationDatasetMetadata(db, options.schema, {
            ...source.datasets.provenance,
            metadata: selectMigrationDatasetMetadata(
              source.preparedDatasets.metadata,
              ready,
            ),
          })
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
