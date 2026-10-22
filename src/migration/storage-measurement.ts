import { MAX_PAGE_SOURCE } from "../af-contracts.ts";
import { writeFile } from "node:fs/promises";
import { readMigrationArchiveSources } from "./archive-sources.ts";
import { readPreparedMigrationPages } from "./prepared-pages.ts";
import { prepareMigrationPageSources } from "./page-source-preparation.ts";
import type { MigrationStorageMeasurement } from "./storage-contracts.ts";
import type {
  MigrationJobSource,
  MigrationJobOptions,
  MigrationJobPlan,
  MigrationPagePlanner,
} from "./job-contracts.ts";
/** Bounded second pass through cached conversions. No destination connection and no capacity assumptions. */
export async function measureMigrationStorage(
  source: MigrationJobSource,
  options: MigrationJobOptions,
  planned: MigrationJobPlan,
  planner: MigrationPagePlanner,
): Promise<MigrationStorageMeasurement> {
  const result: MigrationStorageMeasurement = {
    pages: 0,
    sources: 0,
    normalizedSourceBytes: 0,
    largestNormalizedSourceBytes: 0,
    uniqueBackendJsonBytes: 0,
    rawArchiveRows: 0,
    rawArchiveSourceBytes: 0,
  };
  const backendVersions = new Set<string>();
  for await (const page of readPreparedMigrationPages(
    source,
    options,
    planned,
    planner,
  )) {
    result.pages++;
    for (const r of prepareMigrationPageSources(page, options.origin)) {
      const bytes = Buffer.byteLength(r.prepared.source);
      if (bytes > MAX_PAGE_SOURCE)
        throw Error(
          "Normalized HTML exceeds destination source limit before apply",
        );
      result.sources++;
      result.normalizedSourceBytes += bytes;
      result.largestNormalizedSourceBytes = Math.max(
        result.largestNormalizedSourceBytes,
        bytes,
      );
    }
    for (const b of page.backends ?? []) {
      if (!b.linked) continue;
      const key = JSON.stringify([b.backendId, b.deployment.version]);
      if (backendVersions.has(key)) continue;
      backendVersions.add(key);
      result.uniqueBackendJsonBytes += Buffer.byteLength(
        JSON.stringify(b.deployment),
      );
    }
  }
  const archives = await readMigrationArchiveSources({
    baseDirectory: options.sourceDirectory,
    relationDirectory: source.datasets
      ? options.datasets?.relationDirectory
      : undefined,
  });
  for (const archive of archives)
    for (const part of archive.manifest.parts) {
      result.rawArchiveRows += part.rows;
      result.rawArchiveSourceBytes += part.bytes;
    }
  await writeFile(
    options.reportPath + ".storage.json",
    JSON.stringify({
      complete: true,
      destinationRead: false,
      destinationWrite: false,
      compilerIdentity: planned.compilerIdentity,
      archives: archives.map((a) => ({
        kind: a.kind,
        manifestSha256: a.manifestSha256,
      })),
      measurement: result,
      postgresAllocationEstimate: false,
    }),
    { flag: "wx", mode: 0o600 },
  );
  return result;
}
