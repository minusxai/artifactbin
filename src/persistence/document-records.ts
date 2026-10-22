import { loadGroupAuthority } from "./group-memberships.ts";
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
  if (!row) return null;
  const session = decodeSessionGrant(row);
  session.groupAuthority = await loadGroupAuthority(client, session.actor);
  return session;
}
function decodeHeader(row: Record<string, unknown>): DocumentHeader {
  return {
    id: row.id as string,
    owner: row.owner as string,
    ownerKind: row.principal_kind === "group" ? "group" : "user",
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
      "SELECT f.id,f.owner,f.share_hash,f.generation,f.head,f.sequence,f.share,f.path,f.access,f.source_digest,a.principal_kind FROM files f JOIN accounts a ON a.actor=f.owner WHERE f.id=$1" +
        (locked ? " FOR UPDATE OF f" : ""),
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
