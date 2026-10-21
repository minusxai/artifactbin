import { permissions, policyFor } from "../access.ts";
import { fail } from "../errors.ts";
import type {
  DocumentAuthorizationInput,
  DocumentAuthorizationDecision,
} from "./document-authorization-contracts.ts";
export function authorizeDocument({
  document,
  session,
  credentialHash,
  fileId,
  now,
}: DocumentAuthorizationInput): DocumentAuthorizationDecision {
  const f = document ?? fail(404, "File not found");
  if (session?.purpose === "backend")
    fail(403, "Backend grants cannot access collaboration APIs");
  const valid =
    session &&
    session.expires > now &&
    (!session.fileId ||
      (session.fileId === fileId && session.generation === f.generation));
  const capability = !!credentialHash && f.shareHash === credentialHash;
  if (credentialHash && !valid && !capability)
    fail(403, "Access expired or revoked. Ask the owner for access.");
  const actor = valid ? session.actor : null;
  const grant = permissions(
    f,
    actor,
    !!valid || capability || policyFor(f).visibility === "public",
    !!session?.fileId,
  );
  if (!grant.read) fail(403, "You do not have access to this document.");
  const appEdit =
    grant.edit ||
    (!!valid &&
      session.purpose === "document" &&
      session.fileId === fileId &&
      permissions(f, actor, true).edit);
  return { actor, owner: grant.edit, permissions: grant, appEdit };
}
