import { deletedDatasetBatchFingerprint } from "./deleted-dataset-authority.ts";
import { createHash } from "node:crypto";
import type {
  DeletedArtifactAdmission,
  DeletedArtifactPlan,
  DeletedArtifactPlanningInput,
} from "./deleted-artifact-contracts.ts";
import type { PlannedPage } from "./contracts.ts";
import { migrationPageDigest } from "./import.ts";
import { canonicalMigrationValue } from "./verification-values.ts";
import type { Hash } from "node:crypto";

const sha = (value: unknown) =>
  createHash("sha256").update(canonicalMigrationValue(value)).digest("hex");
const deletionRefusal =
  "Destination cannot preserve exact access or deletion state";
function refuse(): never {
  throw new Error(
    "Deleted artifact admission does not match preserved complete page history",
  );
}
const validVersion = (v: number) => Number.isSafeInteger(v) && v > 0;
const validSha = (v: string) => /^[a-f0-9]{64}$/.test(v);

/** Incrementally hashes the exact current canonical representation of a full plan. */
export function createDeletedArtifactPlanHasher(
  header: Omit<DeletedArtifactPlan, "pages">,
): {
  update(entry: { page: PlannedPage; digest: string }): void;
  digest(): string;
} {
  const empty = canonicalMigrationValue({ ...header, pages: [] });
  const marker = '"pages":[]';
  const at = empty.indexOf(marker);
  if (at < 0 || empty.indexOf(marker, at + 1) >= 0)
    throw new Error("Invalid deleted artifact plan header");
  const hash = createHash("sha256");
  hash.update(empty.slice(0, at) + '"pages":[');
  const suffix = empty.slice(at + marker.length);
  let count = 0;
  return {
    update(entry) {
      if (count++) hash.update(",");
      hash.update(canonicalMigrationValue(entry));
    },
    digest() {
      const copy = hash.copy() as Hash;
      copy.update("]");
      copy.update(suffix);
      return copy.digest("hex");
    },
  };
}

/** Validates the full admission once, then provides the exact existing per-page planner checks. */
export function createDeletedArtifactPageValidator(
  admission: DeletedArtifactAdmission,
  protectedPageIds: ReadonlySet<string>,
): (page: PlannedPage) => { page: PlannedPage; digest: string } {
  if (
    admission.kind !== "deleted-artifact-admission-v1" ||
    !admission.sourceNamespace.trim() ||
    !validSha(admission.archiveDigest)
  )
    refuse();
  const entries = new Map<string, (typeof admission.entries)[number]>();
  const destinations = new Set<string>();
  for (const entry of admission.entries) {
    if (
      !entry.legacyId ||
      !entry.pageId ||
      entries.has(entry.legacyId) ||
      destinations.has(entry.pageId) ||
      protectedPageIds.has(entry.pageId) ||
      !validVersion(entry.headVersion) ||
      !validSha(entry.artifactSha256) ||
      !entry.deletedAt ||
      !Number.isFinite(Date.parse(entry.deletedAt))
    )
      refuse();
    entries.set(entry.legacyId, entry);
    destinations.add(entry.pageId);
  }
  const seen = new Set<string>();
  return (page: PlannedPage) => {
    const entry = entries.get(page.legacyId);
    if (
      !entry ||
      seen.has(page.legacyId) ||
      page.pageId !== entry.pageId ||
      page.original.id !== entry.legacyId ||
      page.original.version !== entry.headVersion ||
      page.original.deleted_at !== entry.deletedAt ||
      sha(page.original) !== entry.artifactSha256 ||
      (page.backendAllocation &&
        page.backendAllocation.sourceNamespace !== admission.sourceNamespace)
    )
      refuse();
    seen.add(page.legacyId);
    if (
      (page.disposition !== "ready" && page.disposition !== "blocked") ||
      page.issues.some((issue) => issue !== deletionRefusal) ||
      (page.disposition === "blocked" && !page.issues.length)
    )
      refuse();
    const expected = new Map<number, string>();
    for (const revision of entry.revisions) {
      if (
        !validVersion(revision.version) ||
        revision.version > entry.headVersion ||
        expected.has(revision.version) ||
        !validSha(revision.artifactSha256)
      )
        refuse();
      expected.set(revision.version, revision.artifactSha256);
    }
    if (
      !expected.has(entry.headVersion) ||
      expected.size !== page.revisions.length
    )
      refuse();
    const versions = new Set<number>();
    for (const revision of page.revisions) {
      const conversion = revision.conversion;
      if (
        versions.has(revision.version) ||
        revision.original.version !== revision.version ||
        expected.get(revision.version) !== sha(revision.original) ||
        typeof conversion.html !== "string" ||
        !conversion.html.trim()
      )
        refuse();
      versions.add(revision.version);
      if (
        revision.version === entry.headVersion &&
        sha(revision.original) !== entry.artifactSha256
      )
        refuse();
      if (conversion.classification === "historical-unavailable") {
        const receipt = conversion.historicalUnavailable;
        if (
          revision.version === entry.headVersion ||
          conversion.strategy !== "historical-unavailable" ||
          conversion.provenance?.compiler !==
            "migration-history-preservation" ||
          conversion.provenance.build !== "1" ||
          conversion.provenance.mode !== "read-only-unavailable" ||
          !receipt ||
          receipt.kind !== "historical-conversion-unavailable" ||
          receipt.policyVersion !== 1 ||
          receipt.version !== revision.version ||
          receipt.originalRecordSha256 !== sha(revision.original) ||
          receipt.originalFormat !== String(revision.original.format) ||
          receipt.originalSourceSha256 !==
            (typeof revision.original.source === "string"
              ? createHash("sha256")
                  .update(revision.original.source)
                  .digest("hex")
              : undefined) ||
          receipt.originalDocumentSha256 !==
            (revision.original.document != null
              ? sha(revision.original.document)
              : undefined) ||
          conversion.issues.length !== 1 ||
          (conversion.issues[0] as { code?: string } | null)?.code !==
            "historical-conversion-unavailable"
        )
          refuse();
      } else if (
        (conversion.classification !== "renderable" &&
          conversion.classification !== "functional") ||
        conversion.issues.length ||
        conversion.strategy === "historical-unavailable" ||
        conversion.historicalUnavailable
      )
        refuse();
    }
    const ready = { ...page, disposition: "ready" as const, issues: [] };
    return { page: ready, digest: migrationPageDigest(ready) };
  };
}

/** The ordinary in-memory planner delegates to the same per-page validator used by replay. */
export function prepareDeletedArtifactPlan(
  input: DeletedArtifactPlanningInput,
): DeletedArtifactPlan {
  const { admission } = input;
  const validatePage = createDeletedArtifactPageValidator(
    admission,
    input.protectedPageIds,
  );
  if (input.pages.length !== admission.entries.length) refuse();
  const pages = input.pages.map(validatePage);
  return {
    kind: "deleted-artifact-plan-v1",
    sourceNamespace: admission.sourceNamespace,
    archiveDigest: admission.archiveDigest,
    admissionSha256: sha(admission),
    pages,
    ...(input.preparedMetadata
      ? {
          metadataBinding: {
            batchSha256: deletedDatasetBatchFingerprint(input.preparedMetadata),
            pageVersions: input.preparedMetadata.metadata.pages
              .map((p) => ({ pageId: p.pageId, version: p.pageVersion }))
              .sort(
                (a, b) =>
                  a.pageId.localeCompare(b.pageId) || a.version - b.version,
              ),
          },
        }
      : {}),
  };
}
