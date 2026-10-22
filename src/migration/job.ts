import { prepareMigrationJobDatasets } from "./job-datasets.ts";
import { writeFile } from "node:fs/promises";
import { destinationSchemas } from "./destination-schema.ts";
import { createMigrationConverter } from "./convert.ts";
import { cachedMigrationConverter, archivedCompilerIdentity } from "./cache.ts";
import { PostgresMigrationDestination } from "./postgres.ts";
import { prepareMigrationJobSource } from "./job-source.ts";
import { createMigrationJobPlanner, planMigrationJob } from "./job-planning.ts";
import { applyMigrationJob } from "./job-apply.ts";
import type {
  MigrationJobOptions,
  MigrationJobPorts,
  MigrationJobSummary,
} from "./job-contracts.ts";
/** The job owns sequencing; no destination port is opened until complete global preflight. */
export async function runMigrationJob(
  options: MigrationJobOptions,
  ports: MigrationJobPorts = {},
): Promise<MigrationJobSummary> {
  destinationSchemas(options.schema);
  if (
    ![1, 2].includes(options.concurrency) ||
    (options.apply && options.concurrency !== 1)
  )
    throw new Error("Destination writes require concurrency 1");
  if (options.apply && !ports.connectDestination)
    throw new Error("Explicit isolated destination connection required");
  const source = await prepareMigrationJobSource(options);
  source.preparedDatasets = await prepareMigrationJobDatasets(source, options, {
    host: ports.backendHost,
  });
  const identify =
    ports.compilerIdentity ??
    (() => archivedCompilerIdentity(options.archivedRoot ?? ""));
  const compilerIdentity = await identify();
  let convert =
    ports.convert ??
    createMigrationConverter({
      strategy: options.conversionStrategy,
      legacyRoot: options.archivedRoot,
    });
  const cache = options.conversionCacheDirectory
    ? cachedMigrationConverter(convert, {
        directory: options.conversionCacheDirectory,
        compilerIdentity,
        strategy: options.conversionStrategy,
      })
    : null;
  if (cache) convert = cache.convert;
  const planner = createMigrationJobPlanner(source, options, convert);
  const destinationOptions = {
    schema: options.schema,
    origin: options.origin,
    isolated: options.apply,
    editorManageRestricted: options.editorManageRestricted,
  };
  const preflight = new PostgresMigrationDestination(
    {
      query: async () => {
        throw new Error("Planning cannot query destination");
      },
    },
    destinationOptions,
    source.maps,
  );
  const planned = await planMigrationJob(source, options, planner, preflight);
  if ((await identify()) !== compilerIdentity)
    throw new Error(
      "Compiler provenance changed during planning; use frozen source checkouts",
    );
  if (options.apply) {
    if (planned.linksRequireLegacyOrigin)
      throw new Error(
        "Explicit legacy origin required to preserve blocked link targets",
      );
    const connection = await ports.connectDestination!();
    try {
      const destination = new PostgresMigrationDestination(
        connection.db,
        destinationOptions,
        source.maps,
      );
      await applyMigrationJob(
        source,
        options,
        planned,
        planner,
        destination,
        connection.db,
      );
    } finally {
      await connection.close();
    }
  }
  const ready = new Set(planned.readiness.ready);
  const summary: MigrationJobSummary = {
    complete: true,
    dryRun: !options.apply,
    inventory: planned.inventory,
    datasets: source.preparedDatasets
      ? {
          imports: source.preparedDatasets.scan.statistics,
          verifiedObjects: source.datasets!.verifiedObjects,
          verifiedBytes: source.datasets!.verifiedBytes,
          preparedBindings: source.preparedDatasets.metadata.bindings.length,
          blockedPages: source.preparedDatasets.issues.size,
          omittedUnmappedTokenPrincipals:
            source.preparedDatasets.omittedUnmappedTokenPrincipals,
          historicalUnavailableRevisions: [
            ...source.preparedDatasets.scan.historicalImportVersions.values(),
          ].reduce((sum, versions) => sum + versions.length, 0),
        }
      : undefined,
    dependencyBlocked: planned.readinessRows.filter(
      (r) => r.ready && !ready.has(r.pageId),
    ).length,
    readinessReport: options.reportPath + ".readiness.json",
    result: planned.totals,
    identitySummary: source.identitySummary,
    groupSummary: source.groupSummary,
    conversionStrategy: options.conversionStrategy,
    conversionCache: cache?.stats,
    conversionProvenance: planned.conversionProvenance,
    compilerIdentity,
  };
  await writeFile(
    options.reportPath + ".summary.json",
    JSON.stringify({ ...summary, maps: source.maps }),
    { mode: 0o600, flag: "wx" },
  );
  return summary;
}
