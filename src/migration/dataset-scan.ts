import {admitInactiveServerDocument} from "./server-document-policy.ts";
import {createDeletedArtifactAdmissionValidator} from "./deleted-artifact-admission.ts";
import {legacySourceOperationRefs,normalizeLegacySourceOperations} from "./conversion/source-operations.ts";
import {catalogVersion,receiptMap} from "./datasets/catalog.ts";
import { attestMigrationSourceQueries } from "./source-query-preparation.ts";
import {
  originalMigrationOwner,
  resolveMigrationOwnership,
} from "./ownership-override.ts";
import { hasLegacyServerModule } from "./query-source.ts";
import { compileNativeProgramResolver } from "./programs/native-compiler.ts";
import { readsMigrationViewer } from "./job-viewer.ts";
import { hasLegacySourceService } from "./conversion/compiled/bound-values.ts";
import { readsMigrationMembers } from "./job-members.ts";
import {
  extractLegacyImports,
  legacyDocumentSource,
} from "./conversion/index.ts";
import type { LegacyRow } from "./contracts.ts";
import type { MigrationJobSource } from "./job-contracts.ts";
import type { MigrationBackendPage } from "./backend-preparation-contracts.ts";
import type { MigrationDatasetImportScan } from "./dataset-scan-contracts.ts";
/** Source bodies are read and released one artifact at a time; only literal dependencies survive. */
export async function scanMigrationDatasetImports(
  source: MigrationJobSource,
  ownershipOverride?: import("./ownership-override-contracts.ts").MigrationOwnershipOverride,
  sourceQueryRegistrations: readonly import("../datasets/source-query/contracts.ts").MigrationSourceQueryRegistration[] = [],
  deletedAdmission?: import("./deleted-artifact-contracts.ts").DeletedArtifactAdmission,
  sourceAdmission: import("./conversion-strategy-contracts.ts").MigrationSourceAdmission = "strict",
  legacyDuckSqlAdmissions: readonly import("./conversion/duck-sql-contracts.ts").LegacyDuckSqlAdmission[] = [],
  inactiveServerDocuments: readonly import("./server-document-contracts.ts").ArchivedInactiveServerPageAdmission[] = [],
): Promise<MigrationDatasetImportScan> {
  const assertDeleted = deletedAdmission ? createDeletedArtifactAdmissionValidator(deletedAdmission,source.manifest.sourceNamespace,source.maps) : undefined;
  const pendingSourceQueryPages = new Set(
    sourceQueryRegistrations.map((q) => q.pageLegacyId),
  );
  const pages: MigrationBackendPage[] = [];
  const issues = new Map<string, string[]>();
  const versions = new Map<string, number | null>();
  const heads = new Map<string, number>();
  const historicalImportVersions = new Map<string, number[]>();
  const historicalServiceVersions = new Map<string, number[]>();
  const statistics = {
    pagesWithImports: 0,
    pagesWithMembers: 0,
    pagesWithViewer: 0,
    headImports: 0,
    historicalImports: 0,
    groupOwnedPages: 0,
    unresolvedPages: 0,
  };
  for (const id of source.ids) {
    const artifact = await source.readArtifact(id);
    const head = artifact.artifacts[0]!;
    if (head.deleted_at && assertDeleted) assertDeleted(head);
    if (pendingSourceQueryPages.has(id)) {
      if (
        (head.deleted_at && !assertDeleted) ||
        head.format !== "markup" ||
        sourceQueryRegistrations.some(
          (q) => q.pageLegacyId === id && q.pageVersion !== head.version,
        )
      )
        throw Error(
          "Source query attestation is not an active current markup head",
        );
      const text =
        typeof head.source === "string" && head.source.trim()
          ? head.source
          : legacyDocumentSource(head.document);
      if (text === null)
        throw Error("Source query attestation source unavailable");
      attestMigrationSourceQueries(
        text,
        id,
        Number(head.version),
        sourceQueryRegistrations,
      );
      pendingSourceQueryPages.delete(id);
    }
    const originals: LegacyRow[] = [
      ...(artifact.tables.artifact_versions ?? []).filter(
        (row) => Number(row.version) !== head.version,
      ),
      head,
    ];
    const revisions: MigrationBackendPage["revisions"][number][] = [];
    let hasImports = false;
    let hasMembers = false;
    let hasViewer = false;
    let hasProgram = false;
    for (const row of originals) {
      if ((row.format ?? head.format) === "program") {
        if (
          Number(row.version) === head.version &&
          (!head.deleted_at || Boolean(assertDeleted)) &&
          head.user_id &&
          !head.group_id
        ) {
          try {
            await compileNativeProgramResolver(String(row.source ?? ""));
            hasProgram = true;
            revisions.push({
              version: Number(row.version),
              imports: [],
              runsProgram: true,
            });
          } catch {
            /* The content converter records the capability refusal. */
          }
        }
        continue;
      }
      if ((row.format ?? head.format) !== "markup") continue;
      let text: string | null;
      try {
        text =
          typeof row.source === "string" && row.source.trim()
            ? row.source
            : legacyDocumentSource(row.document);
      } catch {
        text = null;
      }
      if (text === null) continue;
      const inactivePolicies=inactiveServerDocuments.filter(p=>p.legacyId===id&&p.version===Number(row.version));
      if(inactivePolicies.length>1)throw Error('inactive_server_document_policy_ambiguous');
      const inactive=inactivePolicies.length===1?admitInactiveServerDocument(text,inactivePolicies[0]!):null;

      // Only independently verified stored dataset catalogs can replace legacy source routing.
      if(source.datasets && sourceAdmission === "offline-prototype") {
        const eligible:string[]=[];
        try {
          for(const ref of legacySourceOperationRefs(text)) {
            try {
              const target=(await source.readArtifact(ref.slice(4))).artifacts[0]!;
              const catalog=catalogVersion(target,target.id,receiptMap(source.datasets.receipts));
              if(!catalog.unavailableTables.length && catalog.tables.some(t=>t.schema==='public'&&t.name==='rows'))eligible.push(ref);
            } catch { /* Ordinary source admission retains the unresolved dependency. */ }
          }
          text=normalizeLegacySourceOperations(text,eligible,legacyDuckSqlAdmissions).source;
        } catch { /* The converter retains unsupported source syntax as blocked. */ }
      }
      const extracted = extractLegacyImports(text);
      if (extracted.issues.length) continue; // The content converter retains the complete syntax/capability refusal.
      if (Number(row.version) !== head.version) {
        if (
          extracted.imports.length ||
          hasLegacySourceService(text) ||
          (await readsMigrationViewer(source, text, [])) ||
          (await readsMigrationMembers(source, text, []))
        ) {
          const list = historicalServiceVersions.get(id) ?? [];
          list.push(Number(row.version));
          historicalServiceVersions.set(id, list);
        }

        if (extracted.imports.length) {
          hasImports = true;
          statistics.historicalImports += extracted.imports.length;
          const list = historicalImportVersions.get(id) ?? [];
          list.push(Number(row.version));
          historicalImportVersions.set(id, list);
        }
        revisions.push({ version: Number(row.version), imports: [] });
        continue;
      }
      const imports = [];
      for (const dependency of extracted.imports) {
        if (!versions.has(dependency.datasetLegacyId)) {
          let version: number | null = null;
          try {
            const target = (
              await source.readArtifact(dependency.datasetLegacyId)
            ).artifacts[0];
            if (
              target?.format === "dataset" &&
              Number.isSafeInteger(target.version) &&
              target.version > 0
            )
              version = target.version;
          } catch {}
          versions.set(dependency.datasetLegacyId, version);
        }
        const datasetVersion = versions.get(dependency.datasetLegacyId);
        if (datasetVersion === null || datasetVersion === undefined) {
          const list = issues.get(id) ?? [];
          list.push("Unresolved literal dataset dependency");
          issues.set(id, list);
          continue;
        }
        imports.push({ ...dependency, datasetVersion });
      }
      if (extracted.imports.length) {
        hasImports = true;
        if (Number(row.version) === head.version)
          statistics.headImports += extracted.imports.length;
        else statistics.historicalImports += extracted.imports.length;
      }
      const runsProgram = !inactive && hasLegacyServerModule(text);
      if (runsProgram) hasProgram = true;
      const sourceQueries = attestMigrationSourceQueries(
        text,
        id,
        Number(row.version),
        sourceQueryRegistrations,
      );
      const readsViewer =
        sourceQueries.length > 0 ||
        (await readsMigrationViewer(source, text, imports));
      if (readsViewer) {
        hasViewer = true;
        statistics.pagesWithViewer++;
      }
      const readsMembers = await readsMigrationMembers(source, text, imports);
      if (readsMembers) {
        hasMembers = true;
        statistics.pagesWithMembers++;
      }
      revisions.push({
        version: Number(row.version),
        imports,
        ...(readsMembers ? { readsMembers: true as const } : {}),
        ...(readsViewer ? { readsViewer: true as const } : {}),
        ...(runsProgram ? { runsProgram: true as const } : {}),
        ...(sourceQueries.length ? { sourceQueries } : {}),
      });
    }
    if (!hasImports && !hasMembers && !hasViewer && !hasProgram) continue;
    if (hasImports) statistics.pagesWithImports++;
    heads.set(id, head.version);
    const { owner } = resolveMigrationOwnership(
      head,
      source.manifest.sourceNamespace,
      originalMigrationOwner(
        head,
        source.manifest.sourceNamespace,
        source.maps,
      ),
      ownershipOverride,
    );
    if (owner?.kind === "group") statistics.groupOwnedPages++;
    if (!owner || owner.kind === "orphan")
      issues.set(id, [
        ...(issues.get(id) ?? []),
        "Unmapped dataset page owner",
      ]);
    if (issues.has(id)) {
      statistics.unresolvedPages++;
      continue;
    }
    pages.push({
      legacyId: id,
      pageId: source.maps.pages[id]!,
      owner: owner as MigrationBackendPage["owner"],
      revisions: revisions.sort((a, b) => a.version - b.version),
    });
  }
  if (pendingSourceQueryPages.size)
    throw Error("Source query attestation page outside source scope");
  return {
    pages,
    issues,
    heads,
    historicalImportVersions,
    historicalServiceVersions,
    statistics,
  };
}
