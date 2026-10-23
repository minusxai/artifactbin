import type {
  DeletedArtifactApplyInput,
  DeletedArtifactApplyResult,
} from "./deleted-artifact-contracts.ts";
import { migrationPageDigest } from "./import.ts";
/** Each page commits independently; a later failure is retried using the same sealed digests. */
export async function applyDeletedArtifactPlan(
  input: DeletedArtifactApplyInput,
): Promise<DeletedArtifactApplyResult> {
  const { plan, maps, destination } = input;
  const validHash = (value: string) => /^[a-f0-9]{64}$/.test(value);
  if (
    plan.kind !== "deleted-artifact-plan-v1" ||
    !plan.sourceNamespace.trim() ||
    !validHash(plan.archiveDigest) ||
    !validHash(plan.admissionSha256) ||
    !plan.pages.length
  )
    throw Error("Invalid deleted artifact plan");
  const legacyIds = new Set<string>();
  const pageIds = new Set<string>();
  let revisions = 0;
  for (const { page, digest } of plan.pages) {
    if (
      !page.legacyId ||
      !page.pageId ||
      legacyIds.has(page.legacyId) ||
      pageIds.has(page.pageId) ||
      digest !== migrationPageDigest(page) ||
      maps.pages[page.legacyId] !== page.pageId
    )
      throw Error("Deleted artifact plan binding changed");
    legacyIds.add(page.legacyId);
    pageIds.add(page.pageId);
    revisions += page.revisions.length;
  }
  await destination.prepareDeleted({
    sourceNamespace: plan.sourceNamespace,
    archiveDigest: plan.archiveDigest,
    maps,
  });
  for (const { page } of plan.pages)
    if (!destination.supportsExactDeletedAccess(page))
      throw Error("Destination cannot preserve deleted artifact access");
  await input.verifyProtectedState();
  let created = 0;
  let unchanged = 0;
  for (const { page, digest } of plan.pages) {
    try {
      const result = await destination.importDeletedPage(
        `${plan.sourceNamespace}:${page.legacyId}`,
        digest,
        page,
      );
      if (result === "created") created++;
      else if (result === "unchanged") unchanged++;
      else throw Error("Invalid deleted artifact import result");
    } catch (cause) {
      throw new Error(
        "Deleted artifact page import failed; completed pages remain retryable",
        { cause },
      );
    }
  }
  await input.importMetadata();
  const verification = await input.verifyDeletedState(plan);
  if (
    verification.pages !== plan.pages.length ||
    verification.sources !== revisions
  )
    throw Error("Deleted artifact verification count mismatch");
  await input.verifyProtectedState();
  return {
    complete: true,
    created,
    unchanged,
    pages: plan.pages.length,
    revisions,
    verification,
  };
}
