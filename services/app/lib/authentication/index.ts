/**
 * The authentication module's interface: who a request is, and what a credential brings to an account.
 * Every request credential is resolved once (./request-identity) and every door below is a thin policy over
 * that one answer. It sits above lib/accounts (the identity store) and lib/artifacts, because a token claim
 * and a verified login's guest merge move artifacts in the same transaction as the credential (./ownership).
 * Server-only.
 */
export { browserActor, refusesCrossSite, requestActor, withTokenAuth } from './doors';
export { browserSessionKind, isBrowserSessionRequest, requestOrSessionActor, sessionActor } from './request-identity';
export { auth, overrideSession, type Session } from './session';
export { claimToken, claimTokenById, mergeGuestUsers } from './ownership';
export { setDocumentEditorPolicy, type DocumentEditorPolicy } from './document-editor';
export { hostedAuthorization, hostedOperationCompleted, hostedRefusal } from './request-authority';
