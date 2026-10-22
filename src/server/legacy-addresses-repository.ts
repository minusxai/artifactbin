import type { SqlDatabase } from "../persistence/sql.ts";
import {
  loadDocumentHeader,
  loadSession,
} from "../persistence/document-records.ts";
import { authorizePageRead } from "./document-authorization.ts";
import { hash } from "./text.ts";
import { isFileId } from "../ids/file-id.ts";
import type { LegacyRawRepository } from "./legacy-addresses-contracts.ts";
/** Resolve an exact original under fresh current permission; immutable media reads recheck permission again. */
export function createLegacyRawRepository(
  database: SqlDatabase,
  now: () => number,
): LegacyRawRepository {
  return {
    read(id, credential, version) {
      if (
        !isFileId(id) ||
        (version !== undefined &&
          (!Number.isSafeInteger(version) || version < 1))
      )
        return Promise.resolve(null);
      return database.transaction(async (client) => {
        const session = credential
          ? await loadSession(client, hash(credential))
          : null;
        if (credential && !session) return null;
        const document = await loadDocumentHeader(client, id);
        try {
          authorizePageRead({ document, session, fileId: id, now: now() });
        } catch (error) {
          if (error && typeof error === "object" && "status" in error)
            return null;
          throw error;
        }
        if (!document) return null;
        const revision =
          version === undefined ? document.head : String(version);
        const row = (
          await client.query(
            `SELECT s.content,a.sha256,EXISTS(SELECT 1 FROM page_assets m WHERE m.page_id=s.file_id) AS media_page
         FROM sources s LEFT JOIN page_assets a ON a.page_id=s.file_id AND a.revision=s.revision AND a.variant='original'
         WHERE s.file_id=$1 AND s.revision=$2`,
            [id, revision],
          )
        ).rows[0];
        if (!row) return null;
        if (row.sha256 != null)
          return {
            kind: "media",
            address: {
              pageId: id,
              revision,
              variant: "original",
              sha256: String(row.sha256),
            },
          };
        // A missing original on a known media page must not return its HTML wrapper or another revision.
        if (row.media_page) return null;
        return { kind: "document", source: String(row.content) };
      });
    },
  };
}
