import { prepareStandaloneDatasetJob } from "./dataset-pages/job.ts";
import { prepareMigrationOwnershipDatasetGrants } from "./ownership-dataset-grants.ts";
import { projectMigrationDatasetOwnership } from "./job-dataset-ownership.ts";
import { projectMigrationAttachmentBindings } from "./attachment-bindings.ts";
import { legacyDocumentSource } from "./conversion/index.ts";
import { readLegacyPersonValueNames } from "./conversion/compiled/person-source.ts";
import { projectMigrationPersonBindings } from "./person-binding-validation.ts";
import { projectMigrationProfiles } from "./profiles.ts";
import { prepareMigrationBoundValues } from "./job-bound-values.ts";
import { prepareMigrationHeadMutations } from "./job-mutations.ts";
import { createHash } from "node:crypto";
import { scanMigrationDatasetImports } from "./dataset-scan.ts";
import { prepareMigrationBackends } from "./backend-preparation.ts";
import { planDatasetMetadata } from "./datasets/import-metadata.ts";
import { createDatasetMetadataAccumulator } from "./dataset-metadata-merge.ts";
import { migrationDatasetVersionKey } from "./job-dataset-contracts.ts";
import type { MigrationJobDatasets } from "./job-dataset-contracts.ts";
import type {
  MigrationJobOptions,
  MigrationJobSource,
} from "./job-contracts.ts";
import type {
  MigrationBackendPreparationPorts,
  MigrationBackendReceipt,
} from "./backend-preparation-contracts.ts";
import type { DatasetBrowserBinding } from "./datasets/planner-contracts.ts";
import type { MigrationManifest } from "./contracts.ts";
/** Prepares real compiled receipts and catalog facts before any page is converted or destination connected. */
export async function prepareMigrationJobDatasets(
  source: MigrationJobSource,
  options: MigrationJobOptions,
  ports: MigrationBackendPreparationPorts = {},
): Promise<MigrationJobDatasets | undefined> {
  if (options.standaloneVizPages) return undefined;
  if (options.standaloneDatasetPages) return prepareStandaloneDatasetJob(source, options, ports);
  if (!source.datasets) {
    if (options.sourceQueryRegistrations?.length)
      throw Error("Source query registrations require dataset preparation");
    return undefined;
  }
  const scan = await scanMigrationDatasetImports(
    source,
    options.ownershipOverride,
    options.sourceQueryRegistrations,
  );
  const issues = new Map(
    [...scan.issues].map(([id, reasons]) => [id, [...reasons]]),
  );
  const candidates = scan.pages.filter((page) => {
    const head = scan.heads.get(page.legacyId)!;
    const hasImports = page.revisions.some(
      (r) =>
        r.version === head &&
        (r.imports.length || r.readsMembers || r.readsViewer || r.runsProgram),
    );
    if (hasImports && page.owner.kind === "group") {
      issues.set(page.legacyId, [
        "Group-owned dataset backends are unavailable",
      ]);
      return false;
    }
    return hasImports;
  });
  const boundValueColumns = await prepareMigrationBoundValues(
    source,
    candidates,
    issues,
  );
  const executable = await prepareMigrationHeadMutations(
    source,
    candidates,
    issues,
    boundValueColumns,
    options.sourceAdmission,
  );

  const prepared = await prepareMigrationBackends(
    {
      sourceNamespace: source.manifest.sourceNamespace,
      origin: options.origin,
      allocatedIds: Object.values(source.maps.pages),
      pages: executable,
    },
    ports,
  );
  const accumulator = createDatasetMetadataAccumulator(
    source.manifest.sourceNamespace,
  );
  const mutations = new Map<
    string,
    import("./conversion/compiled/dataset-mutations-contracts.ts").CompiledDatasetMutation[]
  >();
  const bindings = new Map<string, DatasetBrowserBinding[]>();
  const datasetAttachments = new Map<
    string,
    readonly { backendNamespace: string; bindingName: string }[]
  >();
  const personBindings = new Map<
    string,
    { valueName: string; backendNamespace: string }[]
  >();
  const viewerBindings = new Map<
    string,
    import("./conversion/compiled/viewer-contracts.ts").CompiledViewerBinding
  >();
  const membersBindings = new Map<
    string,
    { backendNamespace: string; backendHref: string }
  >();
  const backends = new Map<string, MigrationBackendReceipt[]>();
  const tokenOwners = source.base.tokenOwners.filter(
    (token) => source.maps.tokens[token.id],
  );
  const omittedUnmappedTokenPrincipals =
    source.base.tokenOwners.length - tokenOwners.length;
  const global = planDatasetMetadata({
    manifest: {
      ...source.base,
      artifacts: [],
      tables: {
        ...source.base.tables,
        relations: [...source.datasets.relations],
      },
    },
    maps: source.maps,
    receipts: source.datasets.receipts,
    bindings: [],
    relationProvenance: {
      exportedAt: source.datasets.provenance.relationExportedAt,
      manifestSha256: source.datasets.provenance.relationManifestSha256,
    },
  });
  const profiles = projectMigrationProfiles(
    source.base.tables.users ?? [],
    source.supplementalAssets?.profiles,
  );
  accumulator.add({ ...global.metadata, profiles: profiles.profiles });
  for (const page of executable) {
    const pageReceipts = prepared.receipts.filter(
      (r) => r.pageLegacyId === page.legacyId,
    );
    if (pageReceipts.some((r) => r.viewer)) {
      backends.set(page.legacyId, pageReceipts);
      for (const receipt of pageReceipts)
        if (receipt.viewer && !receipt.sourceQueries)
          viewerBindings.set(
            migrationDatasetVersionKey(
              receipt.pageLegacyId,
              receipt.pageVersion,
            ),
            {
              backendNamespace: receipt.backendNamespace,
              backendHref: new URL(receipt.backendHref).pathname,
            },
          );
    }

    const pageBindings = prepared.bindings.filter(
      (b) => b.pageLegacyId === page.legacyId,
    );
    const memberPages = prepared.receipts
      .filter((r) => r.pageLegacyId === page.legacyId && r.members)
      .map((r) => ({
        pageLegacyId: r.pageLegacyId,
        pageId: r.pageId,
        pageVersion: r.pageVersion,
      }));
    const sourceQueryPages = pageReceipts
      .filter((r) => r.sourceQueries)
      .map((r) => ({
        pageLegacyId: r.pageLegacyId,
        pageId: r.pageId,
        pageVersion: r.pageVersion,
      }));
    const programPages = prepared.receipts
      .filter((r) => r.pageLegacyId === page.legacyId && r.program)
      .map((r) => ({
        pageLegacyId: r.pageLegacyId,
        pageId: r.pageId,
        pageVersion: r.pageVersion,
      }));
    if (
      !pageBindings.length &&
      !memberPages.length &&
      !programPages.length &&
      !sourceQueryPages.length
    )
      continue;
    try {
      const artifact = await source.readArtifact(page.legacyId);
      const referenced = [
        ...new Set(pageBindings.map((b) => b.datasetLegacyId)),
      ];
      const datasets: MigrationManifest[] = [];
      for (const id of referenced) datasets.push(await source.readArtifact(id));
      const tables = {
        ...source.base.tables,
        relations: [...source.datasets.relations],
        artifact_versions: datasets.flatMap(
          (d) => d.tables.artifact_versions ?? [],
        ),
        artifact_shares: [
          ...(artifact.tables.artifact_shares ?? []),
          ...datasets.flatMap((d) => d.tables.artifact_shares ?? []),
        ],
      };
      const plan = planDatasetMetadata({
        manifest: {
          ...source.base,
          tokenOwners: source.base.tokenOwners,
          tables,
          artifacts: [
            artifact.artifacts[0]!,
            ...datasets.flatMap((d) => d.artifacts),
          ],
        },
        maps: source.maps,
        receipts: source.datasets.receipts,
        bindings: pageBindings,
        memberPages,
        programPages,
        sourceQueryPages,
        relationProvenance: {
          exportedAt: source.datasets.provenance.relationExportedAt,
          manifestSha256: source.datasets.provenance.relationManifestSha256,
        },
      });
      const registeredPersons = projectMigrationPersonBindings(
        source.manifest.sourceNamespace,
        page.pageId,
        boundValueColumns.get(
          migrationDatasetVersionKey(
            page.legacyId,
            scan.heads.get(page.legacyId)!,
          ),
        ) ?? [],
        plan.metadata.bindings,
      );
      const headSource = artifact.artifacts[0]!;
      const registeredAttachments =
        headSource.format === "program"
          ? []
          : projectMigrationAttachmentBindings({
              source: headSource.source?.trim()
                ? headSource.source
                : (legacyDocumentSource(headSource.document) ?? ""),
              sourceNamespace: source.manifest.sourceNamespace,
              pageId: page.pageId,
              pageVersion: scan.heads.get(page.legacyId)!,
              bindings: plan.metadata.bindings,
            });
      datasetAttachments.set(
        migrationDatasetVersionKey(
          page.legacyId,
          scan.heads.get(page.legacyId)!,
        ),
        registeredAttachments.map((r) => ({
          backendNamespace: r.backendNamespace,
          bindingName: r.binding.name,
        })),
      );
      const personNames = new Set<string>(
        headSource.format === "program"
          ? []
          : readLegacyPersonValueNames(
              headSource.source?.trim()
                ? headSource.source
                : (legacyDocumentSource(headSource.document) ?? ""),
            ),
      );
      personBindings.set(
        migrationDatasetVersionKey(
          page.legacyId,
          scan.heads.get(page.legacyId)!,
        ),
        registeredPersons
          .filter((person) => personNames.has(person.valueName))
          .map((person) => ({
            valueName: person.valueName,
            backendNamespace: "legacyData",
          })),
      );
      accumulator.add({
        ...projectMigrationDatasetOwnership(
          plan.metadata,
          artifact.artifacts[0]!,
          source,
          options.ownershipOverride,
        ),
        principals: [],
        groups: [],
        personBindings: registeredPersons,
        attachments: registeredAttachments,
        operations: prepared.operations.filter(
          (r) => r.operation.page.id === page.pageId,
        ),
      });
      for (const row of plan.browserBindings) {
        const key = migrationDatasetVersionKey(
          row.pageLegacyId,
          row.pageVersion,
        );
        const list = bindings.get(key) ?? [];
        list.push(row.binding);
        bindings.set(key, list);
      }
      for (const row of prepared.browserMutations.filter(
        (r) => r.pageLegacyId === page.legacyId,
      )) {
        const key = migrationDatasetVersionKey(
          row.pageLegacyId,
          row.pageVersion,
        );
        const list = mutations.get(key) ?? [];
        list.push(row.mutation);
        mutations.set(key, list);
      }
      for (const receipt of prepared.receipts.filter(
        (r) => r.pageLegacyId === page.legacyId && r.members,
      ))
        membersBindings.set(
          migrationDatasetVersionKey(receipt.pageLegacyId, receipt.pageVersion),
          {
            backendNamespace: receipt.backendNamespace,
            backendHref: new URL(receipt.backendHref).pathname,
          },
        );
      backends.set(
        page.legacyId,
        prepared.receipts.filter((r) => r.pageLegacyId === page.legacyId),
      );
    } catch (error) {
      issues.set(page.legacyId, [
        error instanceof Error
          ? error.message
          : "Dataset metadata planning failed",
      ]);
    }
  }
  const inventory = Object.entries(source.maps.pages).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const metadata = accumulator.finish();
  const ownershipDatasetGrants = await prepareMigrationOwnershipDatasetGrants(
    source,
    metadata,
    options.ownershipOverride,
  );
  const sourceQueries = new Map(
    (prepared.sourceQueryRegistrations ?? []).map((group) => [
      migrationDatasetVersionKey(
        group.receipt.pageLegacyId,
        group.receipt.pageVersion,
      ),
      group.queries.map((query) => ({
        name: query.name,
        sourceRef: query.sourceRef,
        backendNamespace: "legacyData" as const,
        backendHref: "/af/v1/ids/" + group.receipt.backendId,
        sqlSha256: query.sqlSha256,
        params: query.params,
        columns: query.columns.map((c) => ({ name: c.name, type: c.type })),
      })),
    ]),
  );
  return {
    metadata,
    ...(sourceQueries.size
      ? {
          sourceQueries,
          sourceQueryRegistrations: prepared.sourceQueryRegistrations,
        }
      : {}),
    ownershipDatasetGrants,
    boundValueColumns,
    membersBindings,
    viewerBindings,
    personBindings,
    datasetAttachments,
    scan,
    bindings,
    mutations,
    backends,
    issues,
    allocation: {
      sourceNamespace: source.manifest.sourceNamespace,
      inventorySha256: createHash("sha256")
        .update(JSON.stringify(inventory))
        .digest("hex"),
    },
    omittedUnmappedTokenPrincipals,
    unavailableProfileImages: profiles.unavailableAvatarImages,
  };
}
