import { createHash } from "node:crypto";
import type { PlannedPage } from "./contracts.ts";
import type { DeletedArtifactAdmission } from "./deleted-artifact-contracts.ts";
import type {
  DeletedArtifactReplayManifest,
  DeletedArtifactReplayPageEntry,
  DeletedArtifactReplayPageRef,
  DeletedArtifactReplayPageSource,
  ValidatedDeletedArtifactReplay,
} from "./deleted-artifact-job-contracts.ts";
import {
  createDeletedArtifactPageValidator,
  createDeletedArtifactPlanHasher,
} from "./deleted-artifact-plan.ts";
import { canonicalMigrationValue } from "./verification-values.ts";

const validSha = (value: string) => /^[a-f0-9]{64}$/.test(value);
const refuse = (): never => {
  throw new Error("Invalid deleted artifact replay plan");
};
const undefinedTag = "$deletedArtifactReplayType";

function freezeTree<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>))
      freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

function encodeReplayValue(value: unknown): unknown {
  if (value === undefined) return { [undefinedTag]: "undefined" };
  if (Array.isArray(value)) return value.map(encodeReplayValue);
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (Object.hasOwn(value, undefinedTag)) {
      return {
        [undefinedTag]: "object",
        entries: entries.map(([key, item]) => [key, encodeReplayValue(item)]),
      };
    }
    return Object.fromEntries(
      entries.map(([key, item]) => [key, encodeReplayValue(item)]),
    );
  }
  return value;
}

function decodeReplayValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeReplayValue);
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (row[undefinedTag] === "undefined" && Object.keys(row).length === 1)
      return undefined;
    if (
      row[undefinedTag] === "object" &&
      Object.keys(row).length === 2 &&
      Array.isArray(row.entries)
    ) {
      const result: Record<string, unknown> = {};
      for (const pair of row.entries) {
        if (
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          typeof pair[0] !== "string" ||
          Object.hasOwn(result, pair[0])
        )
          refuse();
        Object.defineProperty(result, pair[0], {
          value: decodeReplayValue(pair[1]),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return result;
    }
    return Object.fromEntries(
      Object.entries(row).map(([key, item]) => [key, decodeReplayValue(item)]),
    );
  }
  return value;
}

/** Persists optional undefined fields losslessly, preserving existing plan digests. */
export function serializeDeletedArtifactReplayPage(
  entry: DeletedArtifactReplayPageEntry,
): Uint8Array {
  return Buffer.from(JSON.stringify(encodeReplayValue(entry)), "utf8");
}

/** Decodes one bounded, persisted replay entry without changing undefined semantics. */
export function deserializeDeletedArtifactReplayPage(
  bytes: Uint8Array,
): DeletedArtifactReplayPageEntry {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) refuse();
  let parsed: unknown;
  try {
    parsed = decodeReplayValue(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  } catch {
    refuse();
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !("page" in parsed) ||
    !("digest" in parsed)
  )
    refuse();
  const value = parsed as { page: PlannedPage; digest: string };
  if (
    !value.page ||
    typeof value.page !== "object" ||
    typeof value.digest !== "string" ||
    !validSha(value.digest)
  )
    refuse();
  return { page: value.page, digest: value.digest };
}

function planHeader(manifest: DeletedArtifactReplayManifest) {
  return {
    kind: "deleted-artifact-plan-v1" as const,
    sourceNamespace: manifest.sourceNamespace,
    archiveDigest: manifest.archiveDigest,
    admissionSha256: manifest.admissionSha256,
    ...(manifest.metadataBinding
      ? { metadataBinding: manifest.metadataBinding }
      : {}),
  };
}

function validateManifest(
  manifest: DeletedArtifactReplayManifest,
  admission: DeletedArtifactAdmission,
): void {
  if (
    manifest.kind !== "deleted-artifact-replay-plan-v1" ||
    !manifest.sourceNamespace.trim() ||
    manifest.sourceNamespace !== admission.sourceNamespace ||
    manifest.archiveDigest !== admission.archiveDigest ||
    !validSha(manifest.archiveDigest) ||
    !validSha(manifest.admissionSha256) ||
    !validSha(manifest.canonicalPlanSha256) ||
    !Number.isSafeInteger(manifest.pageCount) ||
    manifest.pageCount < 1 ||
    !Number.isSafeInteger(manifest.revisionCount) ||
    manifest.revisionCount < 1 ||
    !Array.isArray(manifest.pages) ||
    manifest.pages.length !== manifest.pageCount ||
    manifest.pageCount !== admission.entries.length
  )
    refuse();
  const byLegacy = new Map(
    admission.entries.map((entry) => [entry.legacyId, entry]),
  );
  if (byLegacy.size !== admission.entries.length) refuse();
  const seenLegacy = new Set<string>(),
    seenPages = new Set<string>();
  let previous = "";
  for (const ref of manifest.pages) {
    if (
      !ref ||
      typeof ref.legacyId !== "string" ||
      !ref.legacyId ||
      typeof ref.pageId !== "string" ||
      !ref.pageId ||
      !Number.isSafeInteger(ref.bytes) ||
      ref.bytes < 1 ||
      !validSha(ref.sha256) ||
      seenLegacy.has(ref.legacyId) ||
      seenPages.has(ref.pageId) ||
      (previous && previous.localeCompare(ref.legacyId) >= 0)
    )
      refuse();
    const entry = byLegacy.get(ref.legacyId);
    if (!entry || entry.pageId !== ref.pageId) refuse();
    previous = ref.legacyId;
    seenLegacy.add(ref.legacyId);
    seenPages.add(ref.pageId);
  }
  if (seenLegacy.size !== byLegacy.size) refuse();
}

async function readEntry(
  source: DeletedArtifactReplayPageSource,
  ref: DeletedArtifactReplayPageRef,
): Promise<DeletedArtifactReplayPageEntry> {
  const bytes = await source.read(ref);
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength !== ref.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== ref.sha256
  )
    refuse();
  return deserializeDeletedArtifactReplayPage(bytes);
}

/** Performs a complete first pass before callers open a database or begin any write phase. */
export async function validateDeletedArtifactReplay(input: {
  manifest: DeletedArtifactReplayManifest;
  admission: DeletedArtifactAdmission;
  source: DeletedArtifactReplayPageSource;
  protectedPageIds: ReadonlySet<string>;
  onPage?: (page: PlannedPage) => void;
}): Promise<ValidatedDeletedArtifactReplay> {
  const { manifest, admission, source, protectedPageIds } = input;
  const manifestSnapshot = freezeTree(structuredClone(manifest));
  const admissionSnapshot = freezeTree(structuredClone(admission));
  const protectedSnapshot = new Set(protectedPageIds);
  validateManifest(manifestSnapshot, admissionSnapshot);
  const validatePage = createDeletedArtifactPageValidator(
    admissionSnapshot,
    protectedSnapshot,
  );
  const header = planHeader(manifestSnapshot);
  const hasher = createDeletedArtifactPlanHasher(header);
  let revisions = 0;
  for (const ref of manifestSnapshot.pages) {
    const entry = await readEntry(source, ref);
    if (
      entry.page.legacyId !== ref.legacyId ||
      entry.page.pageId !== ref.pageId
    )
      refuse();
    const validated = validatePage(entry.page);
    if (
      validated.digest !== entry.digest ||
      canonicalMigrationValue(validated) !== canonicalMigrationValue(entry)
    )
      refuse();
    input.onPage?.(validated.page);
    revisions += entry.page.revisions.length;
    hasher.update(entry);
  }
  if (
    revisions !== manifestSnapshot.revisionCount ||
    hasher.digest() !== manifestSnapshot.canonicalPlanSha256
  )
    refuse();
  const admissionByLegacy = new Map(
    admissionSnapshot.entries.map((entry) => [entry.legacyId, entry]),
  );
  const publications = Object.freeze(
    manifestSnapshot.pages.map((ref) => {
      const entry = admissionByLegacy.get(ref.legacyId);
      const admitted = entry ?? refuse();
      if (admitted.pageId !== ref.pageId) refuse();
      return Object.freeze({
        kind: "deleted-migration-publication-v1" as const,
        sourceNamespace: manifestSnapshot.sourceNamespace,
        archiveDigest: manifestSnapshot.archiveDigest,
        admissionSha256: manifestSnapshot.admissionSha256,
        legacyId: admitted.legacyId,
        pageId: admitted.pageId,
        headVersion: admitted.headVersion,
        deletedAt: admitted.deletedAt,
        artifactSha256: admitted.artifactSha256,
      });
    }),
  );
  return {
    manifest: manifestSnapshot,
    publications,
    pages: async function* () {
      const validateReplayPage = createDeletedArtifactPageValidator(
        admissionSnapshot,
        protectedSnapshot,
      );
      for (const ref of manifestSnapshot.pages) {
        const entry = await readEntry(source, ref);
        const checked = validateReplayPage(entry.page);
        if (
          checked.digest !== entry.digest ||
          canonicalMigrationValue(checked) !== canonicalMigrationValue(entry)
        )
          refuse();
        yield entry;
      }
    },
  };
}

/** Testable canonical digest helper used by the producer and replay-envelope reader. */
export function hashDeletedArtifactReplayEntries(
  manifest: Omit<
    DeletedArtifactReplayManifest,
    "canonicalPlanSha256" | "pages" | "pageCount" | "revisionCount"
  >,
  entries: readonly DeletedArtifactReplayPageEntry[],
): string {
  const hasher = createDeletedArtifactPlanHasher({
    kind: "deleted-artifact-plan-v1",
    sourceNamespace: manifest.sourceNamespace,
    archiveDigest: manifest.archiveDigest,
    admissionSha256: manifest.admissionSha256,
    ...(manifest.metadataBinding
      ? { metadataBinding: manifest.metadataBinding }
      : {}),
  });
  for (const entry of entries) hasher.update(entry);
  return hasher.digest();
}
