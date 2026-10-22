import { runMigrationBoundedWork } from "./bounded-work.ts";
import { prepareMigrationPageQueries } from "./job-queries.ts";
import type { MigrationQueryCompiler } from "./query-preparation-contracts.ts";
import { migrationDatasetVersionKey } from "./job-dataset-contracts.ts";
import { open, writeFile } from "node:fs/promises";
import {
  planMigration,
  applyMigration,
  migrationPageDigest,
} from "./import.ts";
import { resolveMigrationReadiness } from "./dependencies.ts";
import { rewriteMigrationLinks } from "./links.ts";
import { isPreservedNonloginActor } from "./identities.ts";
import type {
  Converter,
  ImportDestination,
  MigrationManifest,
} from "./contracts.ts";
import type { MigrationReadinessRow } from "./dependency-contracts.ts";
import type {
  MigrationJobOptions,
  MigrationJobSource,
  MigrationPagePlanner,
  MigrationJobPlan,
  JobInventory,
} from "./job-contracts.ts";
export function createMigrationJobPlanner(
  source: MigrationJobSource,
  options: MigrationJobOptions,
  convert: Converter,
  queries?: { compiler: MigrationQueryCompiler; compilerIdentity: string },
): MigrationPagePlanner {
  const { maps, media, resourceMap } = source;
  const planArtifact = async (artifact: MigrationManifest) => {
    const plan = await planMigration(artifact, {
      maps,
      historicalUnavailable: options.historicalUnavailable,
      ownershipOverride: options.ownershipOverride,
      convert,
      excludedNativeProgramSources: options.excludedNativeProgramSources,
      nativeProgramBinding: (id, version) => {
        const receipt = source.preparedDatasets?.backends
          .get(id)
          ?.find((b) => b.pageVersion === version && b.linked && b.program);
        return receipt
          ? {
              backendNamespace: receipt.backendNamespace,
              backendHref: receipt.backendHref,
            }
          : undefined;
      },
      datasetAttachments: (id, version) =>
        source.preparedDatasets?.datasetAttachments?.get(
          migrationDatasetVersionKey(id, version),
        ) ?? [],
      personBindings: (id, version) =>
        source.preparedDatasets?.personBindings.get(
          migrationDatasetVersionKey(id, version),
        ) ?? [],
      viewerBinding: (id, version) =>
        source.preparedDatasets?.viewerBindings.get(
          migrationDatasetVersionKey(id, version),
        ),
      membersBinding: (id, version) =>
        source.preparedDatasets?.membersBindings.get(
          migrationDatasetVersionKey(id, version),
        ),
      boundValueColumns: (id, version) =>
        source.preparedDatasets?.boundValueColumns.get(
          migrationDatasetVersionKey(id, version),
        ) ?? [],
      datasetMutations: (id, version) =>
        source.preparedDatasets?.mutations.get(
          migrationDatasetVersionKey(id, version),
        ) ?? [],
      sourceQueries: (id, version) =>
        source.preparedDatasets?.sourceQueries?.get(
          migrationDatasetVersionKey(id, version),
        ),
      datasetBindings: (id, version) =>
        source.preparedDatasets?.bindings.get(
          migrationDatasetVersionKey(id, version),
        ) ?? [],
      datasetUnavailable: (id, version) =>
        source.preparedDatasets?.scan.historicalServiceVersions
          .get(id)
          ?.includes(version) ?? false,
      coreUrl: "/af/v1/core.js",
      media: media
        ? {
            assets: media.assets,
            resourceMap,
            resourceMapAliases: source.resourceMapAliases,
            origin: options.origin,
          }
        : undefined,
    });
    for (const page of plan.pages) {
      const datasets = source.preparedDatasets;
      if (!datasets) continue;
      page.backends = datasets.backends.get(page.legacyId);
      if (page.backends?.length) page.backendAllocation = datasets.allocation;
      const reasons = datasets.issues.get(page.legacyId);
      if (reasons?.length) {
        page.disposition = "blocked";
        page.issues.push(...reasons);
      }
    }
    await prepareMigrationPageQueries(
      plan.pages,
      source.preparedDatasets,
      queries,
    );
    for (const page of plan.pages) {
      const comments = new Set(
        page.comments.filter((c) => !c.deleted_at).map((c) => String(c.id)),
      );
      page.commentAssets = source.supplementalAssets?.comments.filter(
        (asset) =>
          asset.legacyArtifactId === page.legacyId &&
          comments.has(asset.commentId),
      );
    }
    return plan;
  };
  return planArtifact;
}
export async function planMigrationJob(
  source: MigrationJobSource,
  options: MigrationJobOptions,
  planArtifact: MigrationPagePlanner,
  destination: ImportDestination,
): Promise<MigrationJobPlan> {
  const { ids, maps, manifest } = source;
  const concurrency = options.concurrency;
  const readinessRows: MigrationReadinessRow[] = [];
  const pageDigests = new Map<string, string>();
  const pageFormats = new Map<string, string>();
  const links: {
    sourcePageId: string;
    legacyId: string;
    pageId: string;
    unmapped: boolean;
  }[] = [];
  const conversionStrategy = options.conversionStrategy;
  const reportPath = options.reportPath;
  const conversionProvenance: Record<string, number> = {};
  const historicalUnavailable = { pages: 0, revisions: 0 };
  const exclusions: import("./programs/native-contracts.ts").NativeProgramExclusion[] =
    [];
  const report = await open(reportPath, "wx", 0o600);
  let reportWrites = Promise.resolve();
  const writeReport = (line: string) => {
    reportWrites = reportWrites.then(() => report.writeFile(line));
    return reportWrites;
  };
  const inventory: Record<
    string,
    { total: number; ready: number; blocked: number; excluded?: number }
  > = {};
  const totals = { created: 0, unchanged: 0, blocked: 0, errors: 0 };
  try {
    await runMigrationBoundedWork(ids, concurrency, async (id) => {
          const artifact = await source.readArtifact(id);
          try {
            const plan = await planArtifact(artifact);
            for (const exclusion of plan.excludedNativePrograms ?? []) {
              exclusions.push(exclusion);
              const row = (inventory.program ??= {
                total: 0,
                ready: 0,
                blocked: 0,
              });
              row.total++;
              row.excluded = (row.excluded ?? 0) + 1;
              await writeReport(
                JSON.stringify({
                  ...exclusion,
                  legacyId: id,
                  pageId: maps.pages[id],
                  disposition: "excluded",
                }) + "\n",
              );
            }
            for (const page of plan.pages) {
              const unavailableCount = page.revisions.filter(
                r => r.conversion.classification === "historical-unavailable",
              ).length;
              if (unavailableCount) {
                historicalUnavailable.pages++;
                historicalUnavailable.revisions += unavailableCount;
              }
              for (const revision of page.revisions) {
                const p = revision.conversion.provenance;
                const key = JSON.stringify({
                  compilerIdentity:
                    revision.conversion.receipt?.compilerIdentity ?? null,
                  strategy: revision.conversion.strategy ?? conversionStrategy,
                  classification: revision.conversion.classification,
                  compiler: p?.compiler ?? null,
                  build: p?.build ?? null,
                  mode: p?.mode ?? null,
                });
                conversionProvenance[key] =
                  (conversionProvenance[key] ?? 0) + 1;
              }
              if (!destination.supportsExactAccess(page)) {
                page.disposition = "blocked";
                page.issues.push(
                  "Destination cannot preserve exact access or deletion state",
                );
              }
              const row = (inventory[page.original.format] ??= {
                total: 0,
                ready: 0,
                blocked: 0,
              });
              row.total++;
              if (page.disposition === "ready") row.ready++;
              else row.blocked++;
              readinessRows.push({
                pageId: page.pageId,
                ready: page.disposition === "ready",
                dependencies: page.assetDependencies ?? [],
                assets: (page.assets ?? []).map(
                  (a) =>
                    "/af/v1/ids/" +
                    page.pageId +
                    "/assets/" +
                    a.revision +
                    "/" +
                    a.variant +
                    "/" +
                    a.sha256,
                ),
              });
              for (const revision of page.revisions) {
                if (revision.conversion.html === null) continue;
                rewriteMigrationLinks(revision.conversion.html, maps, {
                  legacyOrigins: options.legacyOrigins,
                  targetOrigin: options.origin,
                  readyPages: new Set(),
                  onDiagnostic: ({ legacyId, pageId, disposition }) =>
                    links.push({
                      sourcePageId: page.pageId,
                      legacyId,
                      pageId,
                      unmapped: disposition === "legacy-target-unmapped",
                    }),
                });
              }
              pageDigests.set(page.pageId, migrationPageDigest(page));
              pageFormats.set(page.pageId, page.original.format);
              const result = await applyMigration(plan, destination, {
                dryRun: true,
              });
              totals.created += result.created;
              totals.unchanged += result.unchanged;
              totals.blocked += result.blocked;
              await writeReport(
                JSON.stringify({
                  legacyId: page.legacyId,
                  pageId: page.pageId,
                  format: page.original.format,
                  disposition: page.disposition,
                  provisional: true,
                  assetDependencies: page.assetDependencies,
                  assets: page.assets,
                  unavailableCommentContexts: page.unavailableCommentContexts,
                  ownerAccess:
                    page.owner?.kind === "group"
                      ? "group-membership"
                      : page.owner
                        ? isPreservedNonloginActor(page.owner.id)
                          ? "preserved-nonlogin-unclaimable"
                          : "email-login"
                        : "unmapped",
                  issues: page.issues,
                  revisions: page.revisions.map((r) => ({
                    version: r.version,
                    classification: r.conversion.classification,
                    outputBytes: r.conversion.outputBytes,
                    strategy: r.conversion.strategy ?? conversionStrategy,
                    provenance: r.conversion.provenance,
                    receipt: r.conversion.receipt,
                    ...("sourceRecovery" in r.conversion
                      ? { sourceRecovery: r.conversion.sourceRecovery }
                      : {}),
                    ...("historicalUnavailable" in r.conversion
                      ? { historicalUnavailable: r.conversion.historicalUnavailable }
                      : {}),
                    ...("sourceNormalization" in r.conversion
                      ? { sourceNormalization: r.conversion.sourceNormalization }
                      : {}),
                    issues: r.conversion.issues,
                  })),
                  result,
                }) + "\n",
              );
            }
          } catch (error) {
            if (options.apply) throw error;
            const format = artifact.artifacts[0]!.format;
            const row = (inventory[format] ??= {
              total: 0,
              ready: 0,
              blocked: 0,
            });
            row.total++;
            row.blocked++;
            totals.blocked++;
            totals.errors++;
            readinessRows.push({
              pageId: maps.pages[id]!,
              ready: false,
              dependencies: [],
            });
            await writeReport(
              JSON.stringify({
                legacyId: id,
                pageId: maps.pages[id],
                format,
                disposition: "error",
                issues: [
                  error instanceof Error
                    ? error.message
                    : "Unknown migration plan failure",
                ],
              }) + "\n",
            );
          }
    });
    const readiness = resolveMigrationReadiness(readinessRows);
    const ready = new Set(readiness.ready);
    for (const row of readinessRows)
      if (row.ready && !ready.has(row.pageId)) {
        const rowInventory = inventory[pageFormats.get(row.pageId)!]!;
        rowInventory.ready--;
        rowInventory.blocked++;
        totals.blocked++;
      }
    await writeFile(
      reportPath + ".readiness.json",
      JSON.stringify({
        complete: true,
        sourceNamespace: manifest.sourceNamespace,
        readiness,
        historicalUnavailable,
        ...(exclusions.length
          ? { exclusions, totalExcluded: exclusions.length }
          : {}),
      }),
      { mode: 0o600, flag: "wx" },
    );
    await writeFile(
      reportPath + ".links.json",
      JSON.stringify({
        complete: true,
        diagnostics: links
          .filter(
            (link) => ready.has(link.sourcePageId) && !ready.has(link.pageId),
          )
          .map((link) => ({
            ...link,
            disposition: options.legacyOrigins.length
              ? link.unmapped
                ? "legacy-target-unmapped"
                : "legacy-target-blocked"
              : "legacy-origin-required",
          })),
      }),
      { mode: 0o600, flag: "wx" },
    );
    await reportWrites;
    await report.sync();
    return {
      inventory,
      historicalUnavailable,
      ...(exclusions.length
        ? { exclusions, totalExcluded: exclusions.length }
        : {}),
      totals,
      readiness,
      readinessRows,
      pageDigests,
      conversionProvenance,
      linksRequireLegacyOrigin:
        !options.legacyOrigins.length &&
        links.some(
          (link) => ready.has(link.sourcePageId) && !ready.has(link.pageId),
        ),
    };
  } finally {
    await report.close();
  }
}
