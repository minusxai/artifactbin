import type { FileId, PageRole } from "../af-contracts.ts";
import type { PageCaller } from "../graphql/af-namespace-contracts.ts";
import type { SqlClient } from "../persistence/sql.ts";
import {
  loadDocumentHeader,
  loadSession,
} from "../persistence/document-records.ts";
import { authorizeDocument } from "./document-authorization.ts";
import { fail } from "../errors.ts";
import { hash } from "./text.ts";

/**
 * Brief C's caller(): the credential's identity and role on a page, from the
 * same authorization every other file route uses. An unknown page is a caller
 * with no role; any other refusal is thrown as the route's error.
 */
export function createPageCaller(now: () => number = Date.now) {
  return async function caller(
    client: SqlClient,
    pageId: FileId,
    credential: string,
  ): Promise<PageCaller> {
    const nobody: PageCaller = { pageId, subject: null, role: null };
    const document = await loadDocumentHeader(client, pageId);
    if (!document) return nobody;
    if (document.ownerKind === "group")
      fail(403, "Group-owned pages do not support backend execution");
    const tokenHash = credential ? hash(credential) : null;
    const session = tokenHash ? await loadSession(client, tokenHash) : null;
    // Refusals (expired or revoked credentials, no access) pass through with
    // the same status every other file route gives them.
    const decision = authorizeDocument({
      document,
      session,
      credentialHash: tokenHash,
      fileId: pageId,
      now: now(),
    });
    // A document-scoped session (the hosted runner's) keeps the account's role.
    const role: PageRole | null =
      decision.permissions.role === "owner"
        ? "OWNER"
        : decision.permissions.role === "editor"
          ? "EDITOR"
          : decision.permissions.read
            ? "VIEWER"
            : null;
    return { pageId, subject: decision.actor, role };
  };
}
