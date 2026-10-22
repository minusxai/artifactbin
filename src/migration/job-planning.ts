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
): MigrationPagePlanner {
  const { maps, media, resourceMap } = source;
  const planArtifact = async (artifact: MigrationManifest) => {
    const plan = await planMigration(artifact, {
      maps,
      convert,
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
  const links: { sourcePageId: string; legacyId: string; pageId: string }[] =
    [];
  const conversionStrategy = options.conversionStrategy;
  const reportPath = options.reportPath;
  const conversionProvenance: Record<string, number> = {};
  const report = await open(reportPath, "wx", 0o600);
  let reportWrites = Promise.resolve();
  const writeReport = (line: string) => {
    reportWrites = reportWrites.then(() => report.writeFile(line));
    return reportWrites;
  };
  const inventory: Record<
    string,
    { total: number; ready: number; blocked: number }
  > = {};
  const totals = { created: 0, unchanged: 0, blocked: 0, errors: 0 };
  try {
    for (let offset = 0; offset < ids.length; offset += concurrency)
      await Promise.all(
        ids.slice(offset, offset + concurrency).map(async (id) => {
          const artifact = await source.readArtifact(id);
          try {
            const plan = await planArtifact(artifact);
            for (const page of plan.pages) {
              for (const revision of page.revisions) {
                const p = revision.conversion.provenance;
                const key = JSON.stringify({
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
                  onDiagnostic: ({ legacyId, pageId }) =>
                    links.push({ sourcePageId: page.pageId, legacyId, pageId }),
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
        }),
      );
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
              ? "legacy-target-blocked"
              : "legacy-origin-required",
          })),
      }),
      { mode: 0o600, flag: "wx" },
    );
    await reportWrites;
    await report.sync();
    return {
      inventory,
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
