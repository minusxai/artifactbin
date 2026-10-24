import { nativeCatalogDigest } from "./catalog-digest";
import type { NativeCatalogProjection, NativeCatalogDataset } from "./catalog-contracts";

/** Scope is explicit; legacy callers continue to prove the entire canonical archive. */
export function validateNativeCatalogRevisionScope(p: NativeCatalogProjection) {
  if (p.revisionScope !== undefined && p.revisionScope !== "all" && p.revisionScope !== "latest")
    throw Error("native_catalog_revision_scope");
}

export function validateNativeCatalogDatasetSelection(p: NativeCatalogProjection, d: NativeCatalogDataset) {
  validateNativeCatalogRevisionScope(p);
  if (p.revisionScope === "latest" && (
    d.expectedVersions.length !== 1 || d.expectedVersions[0] !== d.currentVersion ||
    d.versions.length !== 1 || d.versions[0]!.version !== d.currentVersion ||
    d.policyAudit.some(row => row.revision !== d.authority.policyRevision)
  )) throw Error("native_catalog_latest_selection");
}

/** Filter before identity translation: excluded audit actors are not migration dependencies. */
export function nativeCatalogPolicyAuditSelected(p: NativeCatalogProjection, d: NativeCatalogDataset, revision: number) {
  validateNativeCatalogRevisionScope(p);
  return p.revisionScope !== "latest" || Number(revision) === d.authority.policyRevision;
}

/** Complete raw receipts remain authoritative; selecting a head does not rewrite them. */
export function selectNativeCatalogSourceVersions(
  p: NativeCatalogProjection,
  d: NativeCatalogDataset,
  head: Record<string, unknown>,
  archive: readonly Record<string, unknown>[],
): Map<number, Record<string, unknown>> {
  validateNativeCatalogDatasetSelection(p, d);
  const versions = new Map<number, Record<string, unknown>>();
  if (p.revisionScope !== "latest") for (const row of archive) {
    if (row.artifact_id !== d.sourceId) continue;
    if (versions.has(Number(row.version))) throw Error("native_catalog_source_duplicate");
    versions.set(Number(row.version), row);
  }
  versions.set(Number(head.version), head);
  if (Number(head.version) !== d.currentVersion ||
      nativeCatalogDigest([...versions.keys()].sort((a,b)=>a-b)) !==
      nativeCatalogDigest([...d.expectedVersions].sort((a,b)=>a-b)))
    throw Error("native_catalog_source_history");
  return versions;
}
