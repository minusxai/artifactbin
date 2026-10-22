import type { SqlDatabase } from "./sql-contracts.ts";
import type { DatasetAttachmentHttpPorts } from "../server/dataset-attachment-http-contracts.ts";
import { loadSession, loadDocumentHeader } from "./document-records.ts";
import { authorizeDocument } from "../server/document-authorization.ts";
import { hash } from "../server/text.ts";
/** Browser scope is resolved against the saved current page declaration, not caller-selected backend/version/subject. */
export function createDatasetAttachmentContext(
  database: SqlDatabase,
  now = Date.now,
): DatasetAttachmentHttpPorts["resolve"] {
  return (input, signal) =>
    database.transaction(
      async (client) => {
        const credentialHash = input.credential ? hash(input.credential) : null;
        const document = await loadDocumentHeader(client, input.pageId);
        if (!document || document.ownerKind === "group") return null;
        const session = credentialHash
          ? await loadSession(client, credentialHash)
          : null;
        let subject: string | null;
        try {
          subject = authorizeDocument({
            document,
            session,
            credentialHash,
            fileId: input.pageId,
            now: now(),
          }).actor;
        } catch {
          return null;
        }
        const rows = (
          await client.query(
            `SELECT p.file_id,p.version FROM af_page_backends p JOIN files f ON f.id=p.page_id AND f.head=p.page_version::text AND f.deleted_at IS NULL
  WHERE p.page_id=$1 AND p.name=$2`,
            [input.pageId, input.backendNamespace],
          )
        ).rows;
        if (rows.length !== 1) return null;
        return {
          backendId: String(rows[0]!.file_id),
          backendVersion: String(rows[0]!.version),
          pageId: input.pageId,
          subject,
          credentialHash,
          backendNamespace: input.backendNamespace,
          bindingName: input.bindingName,
        };
      },
      { signal, timeoutMs: 1000 },
    );
}
