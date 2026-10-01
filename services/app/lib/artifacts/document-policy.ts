/** Authenticated account claims supplied by the identity bridge, never request JSON. */
export interface VerifiedAccount {
  userId: string | null;
  email?: string | null;
  emailVerified?: boolean;
}

/** Optional host-owned grant for editing markup documents; never ownership or dataset writes. */
export type DocumentEditorPolicy = (account: VerifiedAccount) => boolean;
let policy: DocumentEditorPolicy | undefined;

/** Composition boundary: configure once per host process, before accepting requests. */
export function setDocumentEditorPolicy(next?: DocumentEditorPolicy): void { policy = next; }

/** Row authorization and SQL scopes use the same predicate. No configured policy grants nothing. */
export function hasDocumentEditorAccess(account: VerifiedAccount): boolean {
  return !!account.userId && policy?.(account) === true;
}
