import type {
  MediaReadRepository,
  MediaDescriptor,
} from "../media/contracts.ts";
import type { SqlDatabase } from "./sql.ts";
import { loadDocumentHeader, loadSession } from "./document-records.ts";
import { authorizePageRead } from "../server/document-authorization.ts";
import { hash } from "../server/text.ts";
/** Descriptor and fresh membership facts share the page-read transaction. Never borrow a parent ACL. */
export function mediaRepository(
  database: SqlDatabase,
  now: () => number,
): MediaReadRepository {
  return {
    read(address, credential) {
      return database.transaction(async (client) => {
        const session = credential
          ? await loadSession(client, hash(credential))
          : null;
        // Explicit invalid credentials never silently degrade to anonymous/link authority.
        if (credential && !session) return null;
        const document = await loadDocumentHeader(client, address.pageId);
        try {
          authorizePageRead({
            document,
            session,
            fileId: address.pageId,
            now: now(),
          });
        } catch (error) {
          if (error && typeof error === "object" && "status" in error)
            return null;
          throw error;
        }
        const row = (
          await client.query(
            "SELECT page_id,revision,variant,sha256,content_type,filename,byte_length,storage_key FROM page_assets WHERE page_id=$1 AND revision=$2 AND variant=$3 AND sha256=$4",
            [address.pageId, address.revision, address.variant, address.sha256],
          )
        ).rows[0];
        if (!row) return null;
        return {
          pageId: String(row.page_id),
          revision: String(row.revision),
          variant: row.variant as MediaDescriptor["variant"],
          sha256: String(row.sha256),
          contentType: String(row.content_type),
          filename: row.filename === null ? null : String(row.filename),
          byteLength: Number(row.byte_length),
          storageKey: String(row.storage_key),
        };
      });
    },
  };
}
