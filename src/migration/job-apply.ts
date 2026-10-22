import { PostgresDatasetMetadataDestination } from "./dataset-destination.ts";
import { rewriteMigrationLinks } from "./links.ts";
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
      const bindings = metadata.bindings.filter((b) => ready.has(b.page.id));
      const datasets = new Set(bindings.map((b) => b.dataset.id));
      await new PostgresDatasetMetadataDestination(db, options.schema).import({
        ...source.datasets.provenance,
        metadata: {
          ...metadata,
          bindings,
          operations: metadata.operations?.filter((r) =>
            bindings.some(
              (b) =>
                b.backendId === r.operation.backendId &&
                b.backendVersion === r.operation.backendVersion &&
                b.page.id === r.operation.page.id &&
                b.page.version === r.operation.page.version &&
                b.name === r.bindingName,
            ),
          ),
          pages: metadata.pages.filter((p) => ready.has(p.pageId)),
          resources: metadata.resources.filter((r) => datasets.has(r.legacyId)),
          versions: metadata.versions.filter((v) => datasets.has(v.legacyId)),
          acceptedJoins: metadata.acceptedJoins.filter((j) =>
            ready.has(j.pageId),
          ),
        },
      });
    }
    await applied.sync();
  } finally {
    await applied.close();
  }
}
