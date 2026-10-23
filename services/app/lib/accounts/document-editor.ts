import type { VerifiedAccount } from './actors';

/**
 * The host's optional grant for editing page documents (production: ADMIN__EMAILS), read from VERIFIED
 * account claims. Never ownership, never dataset writes, never a private artifact (lib/artifacts access).
 */
export type DocumentEditorPolicy = (account: VerifiedAccount) => boolean;
let policy: DocumentEditorPolicy | undefined;

/** Composition boundary: configure once per host process, before accepting requests. */
export function setDocumentEditorPolicy(next?: DocumentEditorPolicy): void { policy = next; }

/** Evaluated once per request, by the request-identity resolver alone. No configured policy grants nothing. */
export function hasDocumentEditorAccess(account: VerifiedAccount): boolean {
  return !!account.userId && policy?.(account) === true;
}
