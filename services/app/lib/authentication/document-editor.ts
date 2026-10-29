/**
 * Verified account claims — the INPUT of the host's document-editor policy and of nothing else. The
 * request-identity resolver evaluates the policy once, from the claims the door admitted, and records the
 * answer as `AccessActor.documentEditor`; access code never sees a claim.
 */
export interface VerifiedAccount {
  userId: string | null;
  email?: string | null;
  emailVerified?: boolean;
}

/**
 * The host's optional grant for editing page documents (production: ADMIN__EMAILS), read from VERIFIED
 * account claims. Never ownership, never dataset writes, never a private artifact (lib/artifact-access).
 */
export type DocumentEditorPolicy = (account: VerifiedAccount) => boolean;
let policy: DocumentEditorPolicy | undefined;

/** Composition boundary: configure once per host process, before accepting requests. */
export function setDocumentEditorPolicy(next?: DocumentEditorPolicy): void { policy = next; }

/** Evaluated once per request, by the request-identity resolver alone. No configured policy grants nothing. */
export function hasDocumentEditorAccess(account: VerifiedAccount): boolean {
  return !!account.userId && policy?.(account) === true;
}
