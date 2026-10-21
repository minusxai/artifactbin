import { hash } from "./text.ts";
import { authorizeDocument } from "./document-authorization.ts";
import { fail } from "../errors.ts";
import { accountActor, identityCrypto } from "./identity-policy.ts";
import type { IdentityAuthority } from "./identity-contracts.ts";
import type { IdentityCrypto } from "./identity-repository-contracts.ts";
export function createIdentityAuthority({
  now = Date.now,
  crypto = identityCrypto,
}: { now?: () => number; crypto?: IdentityCrypto } = {}): IdentityAuthority {
  return {
    issue(actor, fileId = null, generation = null) {
      const credential = crypto.token();
      return {
        credential,
        tokenHash: crypto.digest(credential),
        session: { actor, fileId, generation, expires: now() + 30 * 86400000 },
      };
    },
    account: (session) => accountActor(session, now()),
    document({ document, session }, credential, id) {
      const file = document ?? fail(404, "File not found");
      return {
        file,
        ...authorizeDocument({
          document: file,
          session,
          credentialHash: credential ? hash(credential) : null,
          fileId: id,
          now: now(),
        }),
      };
    },
  };
}
