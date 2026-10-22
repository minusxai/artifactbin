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
  if (!source.datasets) return undefined;
  const scan = await scanMigrationDatasetImports(source);
  const issues = new Map(
    [...scan.issues].map(([id, reasons]) => [id, [...reasons]]),
  );
  const candidates = scan.pages.filter((page) => {
    const head = scan.heads.get(page.legacyId)!;
    const hasImports = page.revisions.some(
      (r) => r.version === head && (r.imports.length || r.readsMembers),
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
  const personBindings = new Map<
    string,
    { valueName: string; backendNamespace: string }[]
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
    if (!pageBindings.length && !memberPages.length) continue;
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
      personBindings.set(
        migrationDatasetVersionKey(
          page.legacyId,
          scan.heads.get(page.legacyId)!,
        ),
        registeredPersons.map((person) => ({
          valueName: person.valueName,
          backendNamespace: "legacyData",
        })),
      );
      accumulator.add({
        ...plan.metadata,
        principals: [],
        groups: [],
        personBindings: registeredPersons,
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
            backendHref: receipt.backendHref,
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
  return {
    metadata: accumulator.finish(),
    boundValueColumns,
    membersBindings,
    personBindings,
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
