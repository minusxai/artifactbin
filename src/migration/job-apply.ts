import { open } from "node:fs/promises";
import { stageMigrationMedia } from "./media.ts";
import { PostgresStreamArchive } from "./stream-postgres.ts";
import { readPartRows } from "./stream.ts";
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

    const archive = new PostgresStreamArchive(db, options.schema, true);
    await archive.initialize();
    for (const part of manifest.parts)
      await archive.archivePart(
        manifest.sourceNamespace,
        part,
        readPartRows(options.sourceDirectory, part),
      );
    await destination.prepare({ manifest: base, maps });
    for (const id of ids) {
      if (!ready.has(maps.pages[id]!)) continue;
      const plan = await planArtifact(await source.readArtifact(id));
      for (const page of plan.pages) {
        if (migrationPageDigest(page) !== planned.pageDigests.get(page.pageId))
          throw new Error("Plan changed after global dependency preflight");
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
    await applied.sync();
  } finally {
    await applied.close();
  }
}
