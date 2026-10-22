import { additiveAuthoritySha256 } from "./additive-authority.ts";
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
): Promise<MigrationJobDatasets> {
  if (!source.datasets || !options.standaloneDatasetPages)
    throw Error("Standalone dataset source unavailable");
  const admission = options.standaloneDatasetPages;
  const { pages, issues } = await scanStandaloneDatasetPages(source, options);
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
  const bindings = new Map<
    string,
    import("../datasets/planner-contracts.ts").DatasetBrowserBinding[]
  >();
  for (const page of pages) {
    const artifact = await source.readArtifact(page.legacyId);
    // Only the admitted current source catalog is registered. Earlier raw revisions stay archived,
    // and the normal explicit historical-unavailable policy handles unregistered saved views.
    const manifest = {
      ...artifact,
      tables: {
        ...source.base.tables,
        ...artifact.tables,
        artifact_versions: [],
        relations: [...source.datasets.relations],
      },
      tokenOwners: source.base.tokenOwners.filter(
        (t) => source.maps.tokens[t.id],
      ),
    };
    const plan = planDatasetMetadata({
      manifest,
      maps: source.maps,
      receipts: source.datasets.receipts,
      bindings: prepared.bindings.filter(
        (b) => b.pageLegacyId === page.legacyId,
      ),
      relationProvenance: {
        exportedAt: source.datasets.provenance.relationExportedAt,
        manifestSha256: source.datasets.provenance.relationManifestSha256,
      },
    });
    const version = plan.metadata.versions.find(
      (v) =>
        v.legacyId === page.legacyId &&
        v.version === artifact.artifacts[0]!.version,
    );
    if (!version || version.unavailableTables.length) {
      issues.set(page.legacyId, ["dataset-source-registration-required"]);
      continue;
    }
    accumulator.add(
      projectMigrationDatasetOwnership(
        plan.metadata,
        artifact.artifacts[0]!,
        source,
        options.ownershipOverride,
      ),
    );
    backends.set(
      page.legacyId,
      prepared.receipts.filter((r) => r.pageLegacyId === page.legacyId),
    );
    for (const row of plan.browserBindings)
      bindings.set(
        migrationDatasetVersionKey(row.pageLegacyId, row.pageVersion),
        [row.binding],
      );
  }
  const heads = new Map(
    pages.map((p) => [p.legacyId, p.revisions[0]!.version]),
  );
  return {
    metadata: accumulator.finish(),
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
        historicalImports: 0,
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
