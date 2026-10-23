import { createHash } from "node:crypto";
import { canonicalMigrationValue } from "./verification-values.ts";
import type { DeletedArtifactAdmission } from "./deleted-artifact-contracts.ts";
import type { LegacyRow, MigrationMaps } from "./contracts.ts";
import type { MigrationJobSource } from "./job-contracts.ts";
const sha = (row: unknown) =>
  createHash("sha256").update(canonicalMigrationValue(row)).digest("hex");
const validSha = (value: string) => /^[a-f0-9]{64}$/.test(value);
const validVersion = (value: number) =>
  Number.isSafeInteger(value) && value > 0;
function refuse(): never {
  throw Error("Deleted artifact admission does not match original source");
}
/** Check the complete seal without widening ownership, source or destination authority. */
function validateSeal(
  admission: DeletedArtifactAdmission,
  namespace: string,
  maps: MigrationMaps,
): Map<string, DeletedArtifactAdmission["entries"][number]> {
  if (
    admission.kind !== "deleted-artifact-admission-v1" ||
    !namespace ||
    admission.sourceNamespace !== namespace ||
    !validSha(admission.archiveDigest)
  )
    refuse();
  const ids = new Set<string>(),
    pages = new Set<string>();
  const entries = new Map<
    string,
    DeletedArtifactAdmission["entries"][number]
  >();
  for (const entry of structuredClone(admission.entries)) {
    if (
      !entry.legacyId ||
      ids.has(entry.legacyId) ||
      !/^[A-Za-z0-9]{6}$/.test(entry.pageId) ||
      pages.has(entry.pageId) ||
      maps.pages[entry.legacyId] !== entry.pageId ||
      !validVersion(entry.headVersion) ||
      !validSha(entry.artifactSha256) ||
      !entry.deletedAt.trim() ||
      !Number.isFinite(Date.parse(entry.deletedAt))
    )
      refuse();
    entries.set(entry.legacyId, entry);
    ids.add(entry.legacyId);
    pages.add(entry.pageId);
    const versions = new Set<number>();
    for (const revision of entry.revisions) {
      if (
        !validVersion(revision.version) ||
        versions.has(revision.version) ||
        !validSha(revision.artifactSha256)
      )
        refuse();
      versions.add(revision.version);
    }
    if (
      !entry.revisions.some(
        (r) =>
          r.version === entry.headVersion &&
          r.artifactSha256 === entry.artifactSha256,
      )
    )
      refuse();
  }
  return entries;
}
/** Exact complete raw head identity; never clear or reconstruct its deleted_at. */
export function assertDeletedArtifactAdmissionRow(
  admission: DeletedArtifactAdmission,
  namespace: string,
  maps: MigrationMaps,
  row: LegacyRow,
): void {
  createDeletedArtifactAdmissionValidator(admission, namespace, maps)(row);
}
/** A fresh validated snapshot, never a cache of caller-mutable admission objects. */
export function createDeletedArtifactAdmissionValidator(
  admission: DeletedArtifactAdmission,
  namespace: string,
  maps: MigrationMaps,
): (row: LegacyRow) => void {
  const entries = validateSeal(admission, namespace, maps);
  return (row) => assertRow(entries, row);
}
function assertRow(
  entries: Map<string, DeletedArtifactAdmission["entries"][number]>,
  row: LegacyRow,
): void {
  const entry = entries.get(String(row.id));
  if (
    !entry ||
    row.version !== entry.headVersion ||
    row.deleted_at !== entry.deletedAt ||
    sha(row) !== entry.artifactSha256
  )
    refuse();
}
/** Subset jobs may share one seal, but every selected raw head/history must match before compiling. */
export async function validateDeletedArtifactPreparation(
  source: MigrationJobSource,
  admission: DeletedArtifactAdmission,
): Promise<void> {
  const entries = validateSeal(
    admission,
    source.manifest.sourceNamespace,
    source.maps,
  );
  const namespace = admission.sourceNamespace;
  const ids = new Set<string>();
  for (const id of source.ids) {
    if (ids.has(id)) refuse();
    ids.add(id);
    const artifact = await source.readArtifact(id);
    if (
      artifact.artifacts.length !== 1 ||
      artifact.artifacts[0]!.id !== id ||
      artifact.sourceNamespace !== namespace
    )
      refuse();
    const head = artifact.artifacts[0]!;
    assertRow(entries, head);
    const entry = entries.get(id)!;
    const archived = artifact.tables.artifact_versions ?? [];
    if (archived.some((row) => row.artifact_id !== id)) refuse();
    const overlap = archived.filter((row) => Number(row.version) === head.version);
    const contentFields = ["format", "source", "document", "title", "description", "meta", "actor_user_id", "actor_token_id"];
    if (overlap.length > 1 || overlap.some((row) => contentFields.some((field) => canonicalMigrationValue(row[field] ?? null) !== canonicalMigrationValue(head[field] ?? null)))) refuse();
    const originals = [
      ...archived.filter((row) => !overlap.includes(row)),
      head,
    ];
    if (
      originals.length !== entry.revisions.length ||
      new Set(originals.map((r) => r.version)).size !== originals.length ||
      originals.some(
        (row) =>
          !entry.revisions.some(
            (r) => r.version === row.version && r.artifactSha256 === sha(row),
          ),
      )
    )
      refuse();
  }
}
