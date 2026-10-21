import type { SessionGrant } from "../identity-data-contracts.ts";
import type { DocumentHeader } from "../server/document-authorization-contracts.ts";
import type { SqlClient } from "./sql.ts";
export type { DocumentHeader } from "../server/document-authorization-contracts.ts";
export function decodeSessionGrant(row: Record<string, unknown>): SessionGrant {
  return {
    actor: row.actor as string,
    fileId: row.file_id as string | null,
    generation: row.generation as number | null,
    expires: Number(row.expires),
    ...(row.purpose == null
      ? {}
      : { purpose: row.purpose as SessionGrant["purpose"] }),
    ...(row.backend_version == null
      ? {}
      : { backendVersion: row.backend_version as string }),
  };
}
export async function loadSession(
  client: SqlClient,
  tokenHash: string,
): Promise<SessionGrant | null> {
  const row = (
    await client.query(
      "SELECT actor,file_id,generation,expires,purpose,backend_version FROM sessions WHERE token_hash=$1 FOR SHARE",
      [tokenHash],
    )
  ).rows[0];
  return row ? decodeSessionGrant(row) : null;
}
function decodeHeader(row: Record<string, unknown>): DocumentHeader {
  return {
    id: row.id as string,
    owner: row.owner as string,
    shareHash: row.share_hash as string,
    generation: row.generation as number,
    head: row.head as string,
    sequence: Number(row.sequence),
    share: row.share as string | null,
    path: row.path as string | null,
    sourceDigest: (row.source_digest as string | null) ?? null,
    ...(row.access == null
      ? {}
      : { access: row.access as DocumentHeader["access"] }),
  };
}
async function documentHeader(
  client: SqlClient,
  id: string,
  locked: boolean,
): Promise<DocumentHeader | null> {
  const row = (
    await client.query(
      "SELECT id,owner,share_hash,generation,head,sequence,share,path,access,source_digest FROM files WHERE id=$1" +
        (locked ? " FOR UPDATE" : ""),
      [id],
    )
  ).rows[0];
  return row ? decodeHeader(row) : null;
}
export function loadDocumentHeader(
  client: SqlClient,
  id: string,
): Promise<DocumentHeader | null> {
  return documentHeader(client, id, false);
}
export function lockDocumentHeader(
  client: SqlClient,
  id: string,
): Promise<DocumentHeader | null> {
  return documentHeader(client, id, true);
}
