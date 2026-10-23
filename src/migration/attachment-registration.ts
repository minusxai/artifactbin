import {
  registerDatasetAttachments,
  registerInactiveDatasetAttachments,
} from "../persistence/dataset-attachments.ts";
import { assertDeletedMigrationPublication } from "./inactive-publication.ts";
import {
  validateDeletedDatasetBatch,
  deletedDatasetAuthoritySha256,
} from "./deleted-dataset-authority.ts";
import { readMigrationArchivedArtifact } from "./archived-artifact.ts";
import type { DatasetMigrationBatch } from "./dataset-destination-contracts.ts";
import type { SqlReader } from "./contracts.ts";
/** Publication-only wrapper; normal app registration and invocation retain their live-head guards. */
export async function registerMigrationDatasetAttachments(
  db: SqlReader,
  schema: string,
  batch: DatasetMigrationBatch,
): Promise<void> {
  const client = {
    query: async (text: string, values?: readonly unknown[]) => ({
      ...(await db.query(text, values ? [...values] : undefined)),
      rowCount: null,
    }),
    release: () => {},
  };
  const registrations = batch.metadata.attachments ?? [];
  if (!batch.deletedAdditive)
    return registerDatasetAttachments({ client, registrations });
  const admitted = validateDeletedDatasetBatch(batch);
  for (const registration of registrations) {
    const b = registration.binding,
      entry = admitted.admitted.find(
        (e) => e.pageId === b.page.id && e.version === b.page.version,
      );
    if (!entry)
      throw Error("Inactive attachment outside deleted admitted scope");
    const archived = await readMigrationArchivedArtifact(
      db,
      schema,
      admitted.sourceNamespace,
      entry.legacyId,
    );
    const raw = archived.original;
    if (
      !raw ||
      raw.id !== entry.legacyId ||
      raw.version !== entry.version ||
      typeof raw.deleted_at !== "string"
    )
      throw Error("Inactive attachment raw head unavailable");
    const publication = await assertDeletedMigrationPublication(
      db,
      {
        kind: "deleted-migration-publication-v1",
        schema,
        sourceNamespace: admitted.sourceNamespace,
        archiveDigest: archived.digest,
        admissionSha256: deletedDatasetAuthoritySha256(admitted),
        legacyId: entry.legacyId,
        pageId: entry.pageId,
        headVersion: entry.version,
        deletedAt: raw.deleted_at,
        artifactSha256: entry.artifactSha256,
      },
      {
        backendId: b.backendId,
        backendVersion: b.backendVersion,
        pageId: b.page.id,
        pageVersion: b.page.version,
        sourceNamespace: registration.sourceNamespace,
      },
    );
    await registerInactiveDatasetAttachments({
      client,
      registrations: [registration],
      publication,
    });
  }
}
