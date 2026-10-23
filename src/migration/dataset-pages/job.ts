import { validateDeletedArtifactPreparation } from "../deleted-artifact-admission.ts";
import { admitStandaloneDatasetHistory } from "./history.ts";
import { attestStandaloneDatasetModels } from "./models.ts";
import {
  additiveAuthoritySha256,
  additiveRowSha256,
} from "./additive-authority.ts";
import { projectMigrationDatasetOwnership } from "../job-dataset-ownership.ts";
import { scanStandaloneDatasetPages } from "./scan.ts";
import { prepareMigrationBackends } from "../backend-preparation.ts";
import { planDatasetMetadata } from "../datasets/import-metadata.ts";
import { createDatasetMetadataAccumulator } from "../dataset-metadata-merge.ts";
import { migrationDatasetVersionKey } from "../job-dataset-contracts.ts";
import type { MigrationJobDatasets } from "../job-dataset-contracts.ts";
import type {
  MigrationJobSource,
  MigrationJobOptions,
} from "../job-contracts.ts";
import type { MigrationBackendPreparationPorts } from "../backend-preparation-contracts.ts";
/** Separate opt-in preparation keeps the frozen base graph and allocation ordering untouched. */
export async function prepareStandaloneDatasetJob(
  source: MigrationJobSource,
  options: MigrationJobOptions,
  ports: MigrationBackendPreparationPorts,
  deletedAdmission?: import("../deleted-artifact-contracts.ts").DeletedArtifactAdmission,
): Promise<MigrationJobDatasets> {
  if (!source.datasets || !options.standaloneDatasetPages)
    throw Error("Standalone dataset source unavailable");
  const admission = options.standaloneDatasetPages;
  if (deletedAdmission)
    await validateDeletedArtifactPreparation(source, deletedAdmission);
  const { pages, issues } = await scanStandaloneDatasetPages(
    source,
    options,
    deletedAdmission,
  );
  const reserved = new Set(admission.reservedFileIds);
  if (
    Object.values(source.maps.pages).some((id) => !reserved.has(id)) ||
    reserved.size !== admission.reservedFileIds.length
  )
    throw Error("Standalone reserved ID inventory incomplete");
  const prepared = await prepareMigrationBackends(
    {
      sourceNamespace: source.manifest.sourceNamespace,
      origin: options.origin,
      allocatedIds: admission.reservedFileIds,
      pages,
    },
    ports,
  );
  const accumulator = createDatasetMetadataAccumulator(
    source.manifest.sourceNamespace,
  );
  const backends = new Map<string, typeof prepared.receipts>();
  const pageSources = new Map<
    string,
    import("./contracts.ts").StandaloneDatasetPageInput["source"]
  >();
  const bindings = new Map<
    string,
    import("../datasets/planner-contracts.ts").DatasetBrowserBinding[]
  >();
  for (const page of pages) {
    const artifact = await source.readArtifact(page.legacyId);
    // The opt-in inventory has already sealed every original archived row.
    const manifest = {
      ...artifact,
      tables: {
        ...source.base.tables,
        ...artifact.tables,
        artifact_versions: admission.history
          ? (artifact.tables.artifact_versions ?? [])
          : [],
        relations: [...source.datasets.relations],
      },
      tokenOwners: source.base.tokenOwners.filter(
        (t) => source.maps.tokens[t.id],
      ),
    };
    const plan = planDatasetMetadata({
      ...(deletedAdmission ? { deletedAdmission } : {}),
      manifest,
      maps: source.maps,
      receipts: source.datasets.receipts,
      sourceQueryPages: page.revisions
        .filter((r) => r.standaloneExternalDataset)
        .map((r) => ({
          pageLegacyId: page.legacyId,
          pageId: page.pageId,
          pageVersion: r.version,
          standaloneExternalDataset: r.standaloneExternalDataset,
        })),
      bindings: prepared.bindings.filter(
        (b) => b.pageLegacyId === page.legacyId,
      ),
      relationProvenance: {
        exportedAt: source.datasets.provenance.relationExportedAt,
        manifestSha256: source.datasets.provenance.relationManifestSha256,
      },
    });
    const originals = admitStandaloneDatasetHistory(
      artifact,
      admission,
      page.legacyId,
    );
    let invalidVersion = false;
    for (const revision of page.revisions) {
      const version = plan.metadata.versions.find(
        (v) => v.legacyId === page.legacyId && v.version === revision.version,
      );
      const models = revision.standaloneDataset?.models;
      if (version && models)
        attestStandaloneDatasetModels(
          originals.find((r) => r.version === revision.version)!,
          version,
          models,
        );
      if (
        !version ||
        (!revision.standaloneExternalDataset &&
          version.unavailableTables.length &&
          !models?.length)
      )
        invalidVersion = true;
    }
    if (invalidVersion) {
      issues.set(page.legacyId, ["dataset-source-registration-required"]);
      continue;
    }
    let missingResourceAdmission = false;
    for (const resource of plan.metadata.resources) {
      if (
        admission.base.inventory.resources.some(
          (existing) => existing.legacyId === resource.legacyId,
        )
      )
        continue;
      const expected = admission.heads.find(
        (h) => h.legacyId === resource.legacyId,
      )?.resourceSha256;
      if (!expected) {
        missingResourceAdmission = true;
        continue;
      }
      if (
        !/^[a-f0-9]{64}$/.test(expected) ||
        additiveRowSha256(resource) !== expected
      )
        throw Error("Standalone original resource descriptor differs");
    }
    if (missingResourceAdmission) {
      issues.set(page.legacyId, ["dataset-resource-admission-required"]);
      continue;
    }
    accumulator.add(
      projectMigrationDatasetOwnership(
        {
          ...plan.metadata,
          resources: plan.metadata.resources.map(
            (resource) =>
              admission.base.inventory.resources.find(
                (existing) => existing.legacyId === resource.legacyId,
              ) ?? resource,
          ),
        },
        artifact.artifacts[0]!,
        source,
        options.ownershipOverride,
      ),
    );
    backends.set(
      page.legacyId,
      prepared.receipts.filter((r) => r.pageLegacyId === page.legacyId),
    );
    for (const row of plan.browserBindings) {
      const models = page.revisions.find((r) => r.version === row.pageVersion)
        ?.standaloneDataset?.models;
      if (models?.length) {
        const catalog = (
          originals.find((r) => r.version === row.pageVersion)!.meta as {
            catalog: { tables: { schema: string; name: string }[] };
          }
        ).catalog;
        const order = new Map(
          catalog.tables.map((t, i) => [JSON.stringify([t.schema, t.name]), i]),
        );
        row.binding = {
          ...row.binding,
          tables: [
            ...row.binding.tables,
            ...models.map((m) => ({
              schema: m.schema,
              table: m.table,
              columns: m.columns,
            })),
          ].sort(
            (a, b) =>
              order.get(JSON.stringify([a.schema, a.table]))! -
              order.get(JSON.stringify([b.schema, b.table]))!,
          ),
        };
      }
      pageSources.set(
        migrationDatasetVersionKey(row.pageLegacyId, row.pageVersion),
        { kind: "stored", binding: row.binding },
      );
      bindings.set(
        migrationDatasetVersionKey(row.pageLegacyId, row.pageVersion),
        [row.binding],
      );
    }
    for (const revision of page.revisions.filter(
      (r) => r.standaloneExternalDataset,
    )) {
      const receipt = prepared.receipts.find(
        (r) =>
          r.pageLegacyId === page.legacyId &&
          r.pageVersion === revision.version,
      )!;
      const tables = (
        originals.find((r) => r.version === revision.version)!.meta as {
          catalog: { tables: { schema: string; name: string }[] };
        }
      ).catalog.tables;
      pageSources.set(
        migrationDatasetVersionKey(page.legacyId, receipt.pageVersion),
        {
          kind: "external",
          registered: true,
          backendNamespace: "legacyData",
          backendHref: new URL(receipt.backendHref).pathname,
          tables: revision.sourceQueries!.map((query, i) => ({
            schema: tables[i]!.schema,
            table: tables[i]!.name,
            queryName: query.name,
            columns: query.columns,
          })),
        },
      );
    }
  }
  const heads = new Map(
    pages.map((p) => [p.legacyId, p.revisions[0]!.version]),
  );
  return {
    metadata: accumulator.finish(),
    standaloneDatasetSources: pageSources,
    sourceQueryRegistrations: prepared.sourceQueryRegistrations,
    scan: {
      pages,
      issues,
      heads,
      historicalImportVersions: new Map(),
      historicalServiceVersions: new Map(),
      statistics: {
        pagesWithImports: pages.length,
        pagesWithMembers: 0,
        pagesWithViewer: 0,
        headImports: pages.length,
        historicalImports: pages.reduce(
          (n, p) => n + p.revisions.length - 1,
          0,
        ),
        groupOwnedPages: 0,
        unresolvedPages: issues.size,
      },
    },
    bindings,
    backends,
    issues,
    personBindings: new Map(),
    viewerBindings: new Map(),
    membersBindings: new Map(),
    boundValueColumns: new Map(),
    mutations: new Map(),
    allocation: {
      sourceNamespace: source.manifest.sourceNamespace,
      inventorySha256: additiveAuthoritySha256(admission),
    },
    omittedUnmappedTokenPrincipals: 0,
    unavailableProfileImages: 0,
  };
}
