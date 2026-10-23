import { verifyStandaloneVizBase, recordStandaloneVizReceipt, verifyStandaloneVizReceipt } from "./viz-pages/authority.ts";
import { validateAdditiveVerification } from "./dataset-pages/additive-authority.ts";
import { readPreparedMigrationPages } from "./prepared-pages.ts";
import { admitStandaloneVizSources } from "./viz-pages/admission.ts";
import {
  originalMigrationOwner,
  resolveMigrationOwnership,
  validateMigrationOwnershipOverride,
} from "./ownership-override.ts";
import { validateMigrationSourceAdmission } from "./source-admission-policy.ts";
import { validateNativeProgramExclusions } from "./programs/native-admission.ts";
import { createMigrationQueryCompiler } from "./query-compiler.ts";
import { measureMigrationStorage } from "./storage-measurement.ts";
import { verifyMigrationJob } from "./job-verification.ts";
import { prepareMigrationJobDatasets } from "./job-datasets.ts";
import { writeFile } from "node:fs/promises";
import { destinationSchemas } from "./destination-schema.ts";
import { createMigrationConverter } from "./convert.ts";
import { cachedMigrationConverter } from "./cache.ts";
import { migrationCompilerIdentity } from "./compiler-identity.ts";
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
  if (
    options.storageCapacity !== undefined &&
    (options.storageCapacity !== "operator-verified" ||
      !options.apply ||
      options.verifyOnly ||
      options.measureStorage)
  )
    throw Error(
      "Operator-verified storage capacity requires apply without verify-only or storage measurement",
    );
  const measureStorage = Boolean(
    options.measureStorage ||
      (options.apply && options.storageCapacity !== "operator-verified"),
  );
  if (
    options.historicalUnavailable !== undefined &&
    options.historicalUnavailable !== "preserve"
  ) throw Error("Unknown historical preservation policy");
  const sourceAdmission = validateMigrationSourceAdmission(options);
  validateNativeProgramExclusions(options.excludedNativeProgramSources);
  destinationSchemas(options.schema);
  if (options.apply && options.verifyOnly)
    throw new Error("Choose apply or verify-only");
  if (
    ![1, 2, 3, 4, 5, 6, 7, 8].includes(options.concurrency) ||
    (options.apply && options.concurrency !== 1)
  )
    throw new Error("Destination writes require concurrency 1");
  if ((options.apply || options.verifyOnly) && !ports.connectDestination)
    throw new Error("Explicit isolated destination connection required");
  if(options.standaloneVizPages && (options.standaloneDatasetPages||options.media||options.supplementalAssets||options.sourceQueryRegistrations?.length))throw Error("Visualization addon cannot install backend or media authority");
  if(options.standaloneVizPages)await validateAdditiveVerification(options.standaloneVizPages.admission.base);
  const source = await prepareMigrationJobSource(options);
  if(options.standaloneVizPages)admitStandaloneVizSources(await Promise.all(source.ids.map(id=>source.readArtifact(id))),source.maps,options.standaloneVizPages.admission);
  validateMigrationOwnershipOverride(
    options.ownershipOverride,
    source.manifest.sourceNamespace,
    (options.standaloneDatasetPages||options.standaloneVizPages) ? Object.keys(source.maps.pages) : source.ids,
  );
  // Validate every selected immutable head before dataset/backend preparation, including excluded pages.
  for (const entry of options.ownershipOverride?.entries ?? []) {
    const selected = await source.readArtifact(entry.legacyId);
    const artifact = selected.artifacts.find((a) => a.id === entry.legacyId);
    if (!artifact) throw Error("Ownership override source head missing");
    resolveMigrationOwnership(
      artifact,
      source.manifest.sourceNamespace,
      originalMigrationOwner(
        artifact,
        source.manifest.sourceNamespace,
        source.maps,
      ),
      options.ownershipOverride,
    );
  }
  source.preparedDatasets = await prepareMigrationJobDatasets(source, options, {
    host: ports.backendHost,
  });
  const identify = () =>
    migrationCompilerIdentity(options, ports.compilerIdentity);
  const compilerIdentity = await identify();
  let convert =
    ports.convert ??
    createMigrationConverter({
      strategy: options.conversionStrategy,
      sourceAdmission,
      legacyDuckSqlAdmissions: options.legacyDuckSqlAdmissions,
      legacyColumnAliasAdmissions: options.legacyColumnAliasAdmissions,
      legacyRoot: options.archivedRoot,
      fontBundle: options.fontBundle,
    });
  const cache = options.conversionCacheDirectory
    ? cachedMigrationConverter(convert, {
        directory: options.conversionCacheDirectory,
        compilerIdentity,
        retainedCompilerIdentities: options.retainedCompilerIdentities,
        strategy: options.conversionStrategy,
      })
    : null;
  if (cache) convert = cache.convert;
  const planner = createMigrationJobPlanner(
    source,
    options,
    convert,
    options.archivedRoot
      ? {
          compiler: createMigrationQueryCompiler(options.archivedRoot),
          compilerIdentity,
        }
      : undefined,
  );
  const destinationOptions = {
    schema: options.schema,
    sourceNamespace: source.manifest.sourceNamespace,
    runtimeOwnerRole: options.runtimeOwnerRole,
    ownershipOverride: options.ownershipOverride,
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
  planned.compilerIdentity = compilerIdentity;
  if ((await identify()) !== compilerIdentity)
    throw new Error(
      "Compiler provenance changed during planning; use frozen source checkouts",
    );
  if (measureStorage) {
    await measureMigrationStorage(source, options, planned, planner);
    if ((await identify()) !== compilerIdentity)
      throw Error("Compiler provenance changed during storage measurement");
  }
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
      const vizPages=[];
      if(options.standaloneVizPages){
        for await(const page of readPreparedMigrationPages(source,options,planned,planner))vizPages.push(page);
        await connection.db.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        try{await verifyStandaloneVizBase(connection.db,options.schema,options.standaloneVizPages.admission,options.standaloneVizPages.baseInputs,vizPages,source.maps,options.origin);await connection.db.query("COMMIT");}catch(error){await connection.db.query("ROLLBACK");throw error;}
      }
      await applyMigrationJob(
        source,
        options,
        planned,
        planner,
        destination,
        connection.db,
      );
      await verifyMigrationJob(
        source,
        options,
        planned,
        planner,
        connection.db,
      );
      if(options.standaloneVizPages)await recordStandaloneVizReceipt(connection.db,options.schema,options.standaloneVizPages.admission,vizPages);
    } finally {
      await connection.close();
    }
  }
  if (options.verifyOnly) {
    const connection = await ports.connectDestination!();
    try {
      if(options.standaloneVizPages){
        const pages=[];for await(const page of readPreparedMigrationPages(source,options,planned,planner))pages.push(page);
        await verifyStandaloneVizBase(connection.db,options.schema,options.standaloneVizPages.admission,options.standaloneVizPages.baseInputs,pages,source.maps,options.origin);
        await verifyStandaloneVizReceipt(connection.db,options.schema,options.standaloneVizPages.admission,pages);
      }
      await verifyMigrationJob(
        source,
        options,
        planned,
        planner,
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
    historicalUnavailable: planned.historicalUnavailable,
    ...(planned.exclusions?.length
      ? { exclusions: planned.exclusions, totalExcluded: planned.totalExcluded }
      : {}),
    datasets: source.preparedDatasets
      ? {
          imports: source.preparedDatasets.scan.statistics,
          verifiedObjects: source.datasets!.verifiedObjects,
          verifiedBytes: source.datasets!.verifiedBytes,
          preparedBindings: source.preparedDatasets.metadata.bindings.length,
          blockedPages: source.preparedDatasets.issues.size,
          unavailableProfileImages:
            source.preparedDatasets.unavailableProfileImages,
          omittedUnmappedTokenPrincipals:
            source.preparedDatasets.omittedUnmappedTokenPrincipals,
          historicalUnavailableRevisions: [
            ...source.preparedDatasets.scan.historicalServiceVersions.values(),
          ].reduce((sum, versions) => sum + versions.length, 0),
        }
      : undefined,
    dependencyBlocked: planned.readinessRows.filter(
      (r) => r.ready && !ready.has(r.pageId),
    ).length,
    readinessReport: options.reportPath + ".readiness.json",
    storageReport: measureStorage
      ? options.reportPath + ".storage.json"
      : undefined,
    ...(options.storageCapacity ? { storageCapacity: options.storageCapacity } : {}),
    verificationReport:
      options.apply || options.verifyOnly
        ? options.reportPath + ".verification.json"
        : undefined,
    supplementalAssets: source.supplementalAssets
      ? {
          verifiedAvatars: source.supplementalAssets.profiles.length,
          verifiedCommentVariants: source.supplementalAssets.comments.length,
          unavailableAvatars: source.supplementalAssets.unavailableAvatars,
          unavailableAttachments:
            source.supplementalAssets.unavailableAttachments,
        }
      : undefined,
    result: planned.totals,
    identitySummary: source.identitySummary,
    groupSummary: source.groupSummary,
    conversionStrategy: options.conversionStrategy,
    sourceAdmission,
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
