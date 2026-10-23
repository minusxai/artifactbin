import { readMigrationArchivedArtifact } from "./archived-artifact.ts";
import { createHash } from "node:crypto";
import { FILE_ID_PATTERN } from "../af-contracts.ts";
import { destinationSchemas } from "./destination-schema.ts";
import { canonicalMigrationValue } from "./verification-values.ts";
import type { SqlReader } from "./contracts.ts";
import type {
  DeletedMigrationPublicationContext,
  MigrationPublicationTuple,
} from "./inactive-publication-contracts.ts";
import type { InactivePageRegistration } from "../persistence/inactive-registration-contracts.ts";
/** Reopen exact raw archive and inactive saved link inside the publication transaction. */
export async function assertDeletedMigrationPublication(
  db: SqlReader,
  context: DeletedMigrationPublicationContext,
  tuple: MigrationPublicationTuple,
): Promise<InactivePageRegistration> {
  const sha = (v: unknown) =>
    createHash("sha256").update(canonicalMigrationValue(v)).digest("hex");
  if (
    context.kind !== "deleted-migration-publication-v1" ||
    !context.sourceNamespace ||
    !context.legacyId ||
    !FILE_ID_PATTERN.test(context.pageId) ||
    !FILE_ID_PATTERN.test(tuple.backendId) ||
    !tuple.backendVersion ||
    context.pageId !== tuple.pageId ||
    context.headVersion !== tuple.pageVersion ||
    context.sourceNamespace !== tuple.sourceNamespace ||
    !Number.isSafeInteger(context.headVersion) ||
    context.headVersion < 1 ||
    ![
      context.archiveDigest,
      context.admissionSha256,
      context.artifactSha256,
    ].every((h) => /^[a-f0-9]{64}$/.test(h)) ||
    !Number.isFinite(Date.parse(context.deletedAt))
  )
    throw Error("Invalid inactive migration publication");
  const { runtime } = destinationSchemas(context.schema);
  const saved = await readMigrationArchivedArtifact(
    db,
    context.schema,
    context.sourceNamespace,
    context.legacyId,
  );
  const row = saved.original,
    maps = saved.maps as { pages?: Record<string, string> } | undefined;
  if (
    saved.digest !== context.archiveDigest ||
    maps?.pages?.[context.legacyId] !== context.pageId ||
    !row ||
    row.id !== context.legacyId ||
    row.version !== context.headVersion ||
    row.deleted_at !== context.deletedAt ||
    sha(row) !== context.artifactSha256
  )
    throw Error("Inactive migration archive authority differs");
  const registration = (
    await db.query(
      `SELECT 1 FROM ${runtime}.af_page_backends p JOIN ${runtime}.files f ON f.id=p.page_id AND f.head=p.page_version::text JOIN ${runtime}.sources s ON s.file_id=f.id AND s.revision=f.head WHERE p.file_id=$1 AND p.version=$2 AND p.page_id=$3 AND p.page_version=$4 AND f.deleted_at=$5`,
      [
        tuple.backendId,
        tuple.backendVersion,
        tuple.pageId,
        tuple.pageVersion,
        Date.parse(context.deletedAt),
      ],
    )
  ).rows;
  if (registration.length !== 1)
    throw Error("Inactive migration saved backend authority differs");
  return {
    kind: "inactive-page-registration-v1",
    pageId: context.pageId,
    pageVersion: context.headVersion,
    deletedAt: Date.parse(context.deletedAt),
    sourceNamespace: context.sourceNamespace,
    artifactSha256: context.artifactSha256,
    admissionSha256: context.admissionSha256,
  };
}
