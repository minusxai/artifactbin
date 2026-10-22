import { selectMigrationDatasetMetadata } from "./dataset-selection.ts";
import { PostgresDatasetMetadataDestination } from "./dataset-destination.ts";
import { rewriteMigrationLinks } from "./links.ts";
import { open } from "node:fs/promises";
import { stageMigrationMedia } from "./media.ts";
import {
  archiveMigrationSources,
  readMigrationArchiveSources,
} from "./archive-sources.ts";
import { applyMigration, migrationPageDigest } from "./import.ts";
import type { SqlReader } from "./contracts.ts";
import type { PostgresMigrationDestination } from "./postgres.ts";
import type {
  MigrationJobOptions,
  MigrationJobSource,
  MigrationJobPlan,
  MigrationPagePlanner,
} from "./job-contracts.ts";
/** No live connection is created until the complete dependency plan exists. */
export async function applyMigrationJob(
  source: MigrationJobSource,
  options: MigrationJobOptions,
  planned: MigrationJobPlan,
  planArtifact: MigrationPagePlanner,
  destination: PostgresMigrationDestination,
  db: SqlReader,
): Promise<void> {
  const { ids, maps, manifest, base, media } = source;
  const ready = new Set(planned.readiness.ready);

  const applied = await open(options.reportPath + ".apply.ndjson", "wx", 0o600);
  try {
    if (media) {
      if (!options.media?.stagingDirectory)
        throw new Error("Explicit media staging directory required");
      await stageMigrationMedia(media.assets, options.media?.stagingDirectory);
    }

    await archiveMigrationSources(
      db,
      options.schema,
      await readMigrationArchiveSources({
        baseDirectory: options.sourceDirectory,
        relationDirectory: source.datasets
          ? options.datasets?.relationDirectory
          : undefined,
      }),
    );
    await destination.prepare({ manifest: base, maps });
    if (destination.accountProfileSummary)
      for (const [key, value] of Object.entries(
        destination.accountProfileSummary,
      ))
        source.identitySummary[
          "accountProfile" + key[0]!.toUpperCase() + key.slice(1)
        ] = value;
    for (const id of ids) {
      if (!ready.has(maps.pages[id]!)) continue;
      const plan = await planArtifact(await source.readArtifact(id));
      for (const page of plan.pages) {
        if (migrationPageDigest(page) !== planned.pageDigests.get(page.pageId))
          throw new Error("Plan changed after global dependency preflight");
      }
      for (const page of plan.pages)
        for (const revision of page.revisions) {
          if (revision.conversion.html === null) continue;
          revision.conversion.html = rewriteMigrationLinks(
            revision.conversion.html,
            maps,
            {
              legacyOrigins: options.legacyOrigins,
              targetOrigin: options.origin,
              readyPages: ready,
              onDiagnostic: (diagnostic) => {
                if (diagnostic.disposition === "legacy-origin-required")
                  throw new Error(
                    "Explicit legacy origin required to preserve a blocked link target",
                  );
              },
            },
          );
        }
      const result = await applyMigration(plan, destination, {
        dryRun: false,
        globallyReadyPages: ready,
      });
      planned.totals.created += result.created;
      planned.totals.unchanged += result.unchanged;
      await applied.writeFile(
        JSON.stringify({ legacyId: id, pageId: maps.pages[id], result }) + "\n",
      );
    }
    if (source.preparedDatasets && source.datasets) {
      const metadata = source.preparedDatasets.metadata;
      await new PostgresDatasetMetadataDestination(db, options.schema).import({
        ...source.datasets.provenance,
        profileAssets: source.supplementalAssets?.profiles,
        metadata: selectMigrationDatasetMetadata(metadata, ready),
      });
    }
    await applied.sync();
  } finally {
    await applied.close();
  }
}
