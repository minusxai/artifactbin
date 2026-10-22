import type { SqlClient, SqlDatabase } from "./sql.ts";
import type {
  SupplementalAddress,
  SupplementalDescriptor,
  SupplementalRepository,
} from "../media/supplemental-contracts.ts";
import type { DatasetPersonService } from "../datasets/person-contracts.ts";
import { loadDocumentHeader, loadSession } from "./document-records.ts";
import { authorizePageRead } from "../server/document-authorization.ts";
import { createPageCaller } from "../server/af-caller.ts";
import { supplementalAddress } from "../media/supplemental-address.ts";
import { hash } from "../server/text.ts";
export function supplementalRepository(
  database: SqlDatabase,
  now: () => number,
  person: DatasetPersonService,
): SupplementalRepository {
  async function permitted(
    client: SqlClient,
    address: SupplementalAddress,
    credential: string,
  ) {
    const session = credential
      ? await loadSession(client, hash(credential))
      : null;
    if (credential && !session) return false;
    try {
      return authorizePageRead({
        document: await loadDocumentHeader(client, address.pageId),
        session,
        fileId: address.pageId,
        now: now(),
      }).read;
    } catch (error) {
      if (error && typeof error === "object" && "status" in error) return false;
      throw error;
    }
  }
  function descriptor(
    address: SupplementalAddress,
    row: Record<string, unknown>,
  ): SupplementalDescriptor {
    return {
      address,
      sha256: String(row.sha256),
      byteLength: Number(row.byte_length),
      width: Number(row.width),
      height: Number(row.height),
      contentType: row.content_type as "image/webp",
      storageKey: String(row.storage_key),
      filename:
        address.kind === "comment" ? String(row.name) : "Profile image.webp",
    };
  }
  async function loadPerson(
    address: Extract<SupplementalAddress, { kind: "person" }>,
    credential: string,
  ) {
    return database.transaction(async (client) => {
      if (!(await permitted(client, address, credential))) return null;
      let caller;
      try {
        caller = await createPageCaller(now)(
          client,
          address.pageId,
          credential,
        );
      } catch(error) {
        if(error && typeof error==="object" && "status" in error)return null;
        throw error;
      }
      const rows = (
        await client.query(
          `SELECT a.*,b.backend_id,b.backend_version FROM profile_assets a
        JOIN dataset_public_profiles u ON u.source_namespace=a.source_namespace AND u.legacy_user_id=a.legacy_user_id AND u.image=a.asset_id
        JOIN dataset_person_bindings b ON b.source_namespace=a.source_namespace
        JOIN files f ON f.id=b.page_id AND f.head=b.page_version::text AND f.deleted_at IS NULL
        WHERE b.page_id=$1 AND b.value_name=$2 AND a.asset_id=$3
        AND EXISTS(SELECT 1 FROM af_page_backends p WHERE p.file_id=b.backend_id AND p.version=b.backend_version AND p.page_id=b.page_id AND p.page_version=b.page_version)`,
          [address.pageId, address.valueName, address.assetId],
        )
      ).rows;
      if (rows.length !== 1) return null;
      return { row: rows[0]!, caller };
    });
  }
  return {
    async read(address, credential, signal) {
      signal?.throwIfAborted();
      if (address.kind === "comment")
        return database.transaction(async (client) => {
          if (!(await permitted(client, address, credential))) return null;
          const row = (
            await client.query(
              `SELECT a.* FROM comment_attachment_assets a JOIN comments c ON c.file_id=a.page_id AND c.id=a.comment_id WHERE a.page_id=$1 AND a.comment_id=$2 AND a.attachment_id=$3 AND a.variant=$4`,
              [
                address.pageId,
                address.commentId,
                address.attachmentId,
                address.variant,
              ],
            )
          ).rows[0];
          signal?.throwIfAborted();
          return row ? descriptor(address, row) : null;
        });
      const initial = await loadPerson(address, credential);
      if (!initial) return null;
      const card = await person.person(
        {
          pageId: address.pageId,
          backendId: String(initial.row.backend_id),
          backendVersion: String(initial.row.backend_version),
          subject: initial.caller.subject,
        },
        {
          valueName: address.valueName,
          userId: String(initial.row.legacy_user_id),
        },
        signal,
      );
      signal?.throwIfAborted();
      if (card?.image !== supplementalAddress(address)) return null;
      const fresh = await loadPerson(address, credential);
      signal?.throwIfAborted();
      if (!fresh || JSON.stringify(fresh) !== JSON.stringify(initial))
        return null;
      return descriptor(address, fresh.row);
    },
  };
}
