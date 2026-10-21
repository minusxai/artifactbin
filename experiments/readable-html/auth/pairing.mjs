import { randomBytes } from "node:crypto";
import { challengeFor } from "./policy.mjs";
/** @param {import('./contracts.ts').AuthPolicy} auth @param {()=>number} [now] @returns {import('./contracts.ts').PairingPolicy} */
export function createPairing(auth, now = Date.now) {
  /** @type {Map<string,{request:import('./contracts.ts').GrantRequest,expiresAt:number,grant:import('./contracts.ts').Grant|null}>} */ const pending =
    new Map();
  /** @param {string} id */
  function get(id) {
    const item = pending.get(id);
    if (!item || item.expiresAt <= now()) throw Error("expired-or-unknown");
    return item;
  }
  return {
    begin(request) {
      if (
        !["a", "b"].includes(request.documentId) ||
        !/^[a-z0-9]{32,64}$/.test(request.channel) ||
        !/^[a-f0-9]{64}$/.test(request.challenge)
      )
        throw Error("invalid-request");
      const requestId = randomBytes(24).toString("hex"),
        expiresAt = now() + 60000;
      pending.set(requestId, {
        request: { ...request },
        expiresAt,
        grant: null,
      });
      return { requestId, documentId: request.documentId, expiresAt };
    },
    describe(id) {
      const item = get(id);
      return { documentId: item.request.documentId, expiresAt: item.expiresAt };
    },
    approve(account, id) {
      const item = get(id);
      if (item.grant) throw Error("already-approved");
      item.grant = auth.issue(account, item.request);
    },
    poll(id, verifier) {
      const item = get(id);
      if (challengeFor(verifier) !== item.request.challenge)
        throw Error("wrong-verifier");
      if (!item.grant) return null;
      const session = auth.redeem({
        ...item.request,
        code: item.grant.code,
        verifier,
      });
      pending.delete(id);
      return session;
    },
  };
}
