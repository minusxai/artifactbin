import { hash } from "./text.ts";
/** Non-authorizing, page-scoped equality marker for a freshly authorized account incarnation. */
export function callerAuthorizationContext(
  page: string,
  principalSpace: string | undefined,
): string | null {
  return principalSpace
    ? hash(JSON.stringify(["page-caller-v1", page, principalSpace]))
    : null;
}

/** Anonymous capability callers are bound to the exact live share generation, never a global guest. */
export function guestAuthorizationContext(
  page: string,
  credentialHash: string,
  shareHash: string,
  generation: number,
): string | null {
  return credentialHash && credentialHash === shareHash
    ? hash(JSON.stringify(["page-capability-v1", page, shareHash, generation]))
    : null;
}
