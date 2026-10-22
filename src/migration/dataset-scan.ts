import { hasLegacyBoundValueSource } from "./conversion/compiled/bound-values.ts";
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
): Promise<MigrationDatasetImportScan> {
  const pages: MigrationBackendPage[] = [];
  const issues = new Map<string, string[]>();
  const versions = new Map<string, number | null>();
  const heads = new Map<string, number>();
  const historicalImportVersions = new Map<string, number[]>();
  const historicalServiceVersions = new Map<string, number[]>();
  const statistics = {
    pagesWithImports: 0,
    pagesWithMembers: 0,
    headImports: 0,
    historicalImports: 0,
    groupOwnedPages: 0,
    unresolvedPages: 0,
  };
  for (const id of source.ids) {
    const artifact = await source.readArtifact(id);
    const head = artifact.artifacts[0]!;
    const originals: LegacyRow[] = [
      ...(artifact.tables.artifact_versions ?? []).filter(
        (row) => Number(row.version) !== head.version,
      ),
      head,
    ];
    const revisions: MigrationBackendPage["revisions"][number][] = [];
    let hasImports = false;
    let hasMembers = false;
    for (const row of originals) {
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
      const extracted = extractLegacyImports(text);
      if (extracted.issues.length) continue; // The content converter retains the complete syntax/capability refusal.
      if (Number(row.version) !== head.version) {
        if (
          extracted.imports.length ||
          hasLegacyBoundValueSource(text) ||
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
      const readsMembers = await readsMigrationMembers(source, text, imports);
      if (readsMembers) {
        hasMembers = true;
        statistics.pagesWithMembers++;
      }
      revisions.push({
        version: Number(row.version),
        imports,
        ...(readsMembers ? { readsMembers: true as const } : {}),
      });
    }
    if (!hasImports && !hasMembers) continue;
    if (hasImports) statistics.pagesWithImports++;
    heads.set(id, head.version);
    const kind = head.group_id ? "group" : head.user_id ? "user" : "token";
    const key = String(head.group_id ?? head.user_id ?? head.token_id ?? "");
    const owner =
      source.maps[
        kind === "group" ? "groups" : kind === "user" ? "users" : "tokens"
      ][key];
    if (kind === "group") statistics.groupOwnedPages++;
    if (!owner)
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
      owner: { kind, id: owner! },
      revisions: revisions.sort((a, b) => a.version - b.version),
    });
  }
  return {
    pages,
    issues,
    heads,
    historicalImportVersions,
    historicalServiceVersions,
    statistics,
  };
}
