import { createHash } from "node:crypto";
import { canonical } from "../datasets/catalog.ts";
import type { LegacyRow, MigrationManifest } from "../contracts.ts";
import type { StandaloneDatasetJobAdmission } from "./admission-contracts.ts";
const sha = (row: LegacyRow) =>
  createHash("sha256").update(canonical(row)).digest("hex");
function assertHeadOverlap(head: LegacyRow, row: LegacyRow): void {
  const fields = [
    "format",
    "source",
    "document",
    "title",
    "description",
    "meta",
    "actor_user_id",
    "actor_token_id",
  ];
  if (
    row.artifact_id !== head.id ||
    fields.some(
      (field) =>
        canonical(row[field] ?? null) !== canonical(head[field] ?? null),
    )
  )
    throw Error("Conflicting archived and current dataset source revision");
}
/** Returns original rows, never head-overlaid archives or invented missing originals. */
export function admitStandaloneDatasetHistory(
  manifest: MigrationManifest,
  admission: StandaloneDatasetJobAdmission,
  legacyId: string,
): LegacyRow[] {
  const head = manifest.artifacts[0]!;
  if (!admission.history) return [head];
  const history = admission.history;
  if (history.kind !== "standalone-dataset-history-v1")
    throw Error("Invalid standalone dataset history inventory");
  const expected = new Map<number, string>();
  const admittedIds = new Set(admission.heads.map((h) => h.legacyId));
  for (const entry of history.revisions) {
    if (
      !admittedIds.has(entry.legacyId) ||
      !Number.isSafeInteger(entry.version) ||
      entry.version < 1 ||
      !/^[a-f0-9]{64}$/.test(entry.artifactSha256)
    )
      throw Error("Invalid standalone dataset history inventory");
    if (entry.legacyId !== legacyId) continue;
    if (expected.has(entry.version) || entry.version === head.version)
      throw Error("Invalid duplicate standalone dataset history inventory");
    expected.set(entry.version, entry.artifactSha256);
  }
  const originals = new Map<number, LegacyRow>();
  let headOverlap = false;
  for (const row of manifest.tables.artifact_versions ?? []) {
    if (row.artifact_id !== legacyId)
      throw Error("Invalid standalone dataset history owner");
    const version = Number(row.version);
    if (
      !Number.isSafeInteger(version) ||
      version < 1 ||
      row.format !== "dataset"
    )
      throw Error("Invalid standalone dataset history version");
    // The head may also have a saved archive record; the normal page planner checks content equivalence.
    if (version === head.version) {
      if (headOverlap) throw Error("Duplicate archived dataset head");
      headOverlap = true;
      assertHeadOverlap(head, row);
      continue;
    }
    if (originals.has(version))
      throw Error("Invalid duplicate standalone dataset history version");
    originals.set(version, row);
  }
  if (
    originals.size !== expected.size ||
    [...originals.keys()].some((v) => !expected.has(v))
  )
    throw Error("Standalone dataset history inventory differs");
  for (const [version, row] of originals)
    if (sha(row) !== expected.get(version))
      throw Error("Standalone dataset history source changed");
  return [
    head,
    ...[...originals].sort(([a], [b]) => a - b).map(([, row]) => row),
  ];
}

/** Operator-side producer for a fresh additive identity; does not change the source or base. */
export async function collectStandaloneDatasetHistory(
  source: Pick<
    import("../job-contracts.ts").MigrationJobSource,
    "ids" | "readArtifact"
  >,
  heads: StandaloneDatasetJobAdmission["heads"],
): Promise<NonNullable<StandaloneDatasetJobAdmission["history"]>> {
  const revisions: NonNullable<
    StandaloneDatasetJobAdmission["history"]
  >["revisions"][number][] = [];
  const seen = new Set<string>();
  for (const expected of heads) {
    if (seen.has(expected.legacyId) || !source.ids.includes(expected.legacyId))
      throw Error("Invalid standalone dataset history scope");
    seen.add(expected.legacyId);
    const manifest = await source.readArtifact(expected.legacyId);
    const head = manifest.artifacts[0];
    if (
      !head ||
      head.id !== expected.legacyId ||
      head.format !== "dataset" ||
      head.version !== expected.version ||
      sha(head) !== expected.artifactSha256
    )
      throw Error("Standalone dataset history head changed");
    const versions = new Set<number>();
    let headOverlap = false;
    for (const row of manifest.tables.artifact_versions ?? []) {
      if (row.version === head.version) {
        if (headOverlap) throw Error("Duplicate archived dataset head");
        headOverlap = true;
        assertHeadOverlap(head, row);
        continue;
      }
      if (
        row.artifact_id !== head.id ||
        row.format !== "dataset" ||
        !Number.isSafeInteger(row.version) ||
        Number(row.version) < 1 ||
        versions.has(Number(row.version))
      )
        throw Error("Invalid duplicate standalone dataset history source");
      versions.add(Number(row.version));
      revisions.push({
        legacyId: head.id,
        version: Number(row.version),
        artifactSha256: sha(row),
      });
    }
  }
  return {
    kind: "standalone-dataset-history-v1",
    revisions: revisions.sort(
      (a, b) => a.legacyId.localeCompare(b.legacyId) || a.version - b.version,
    ),
  };
}

/** The immutable base checks use this only to scope the separately sealed additive job. */
export function standaloneDatasetVersionScope(
  admission: StandaloneDatasetJobAdmission,
): ReadonlyMap<string, string> {
  const entries = [...admission.heads, ...(admission.history?.revisions ?? [])];
  if (
    admission.history &&
    admission.history.kind !== "standalone-dataset-history-v1"
  )
    throw Error("Invalid standalone dataset history inventory");
  const heads = new Set(admission.heads.map((h) => h.legacyId));
  const scope = new Map<string, string>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.legacyId, entry.version]);
    if (
      !heads.has(entry.legacyId) ||
      !Number.isSafeInteger(entry.version) ||
      entry.version < 1 ||
      !/^[a-f0-9]{64}$/.test(entry.artifactSha256) ||
      scope.has(key)
    )
      throw Error("Invalid standalone dataset version scope");
    scope.set(key, entry.artifactSha256);
  }
  return scope;
}

/** Never borrows the current head edit identity for a saved source version. */
export function standaloneDatasetEditIdentity(
  row: LegacyRow,
  historical: boolean,
): { editId: string; editIdentity?: "source-version-sha256" } {
  if (typeof row.edit_id === "string" && row.edit_id)
    return { editId: row.edit_id };
  if (!historical || row.edit_id != null)
    throw Error("Standalone dataset original edit identity unavailable");
  return {
    editId: "dataset-version:" + sha(row),
    editIdentity: "source-version-sha256",
  };
}
export function assertStandaloneDatasetEditIdentity(
  row: LegacyRow,
  historical: boolean,
  provenance: Pick<
    import("./admission-contracts.ts").StandaloneDatasetPageProvenance,
    "editId" | "editIdentity"
  >,
): void {
  const expected = standaloneDatasetEditIdentity(row, historical);
  if (
    expected.editId !== provenance.editId ||
    expected.editIdentity !== provenance.editIdentity
  )
    throw Error("Standalone dataset edit identity differs");
}
