/**
 * The artifacts module's whole interface. Everything outside `lib/artifacts` imports from here and
 * nothing else (DEEP_MODULES in scripts/ci/module-graph.mjs refuses a deep import); tests may import a
 * defining file directly, so names only tests use are not listed. Grouped by who calls them.
 */

/** Reads and access (every server caller): the row, the role decision and its scopes, the reader snapshot, the lookups, versions and listings, capabilities, views and the state digest. */
export { canReadArtifact, roleFor, effectiveRole, isOwner, editorScope, writerFor } from './access';
export type { ArtifactRow } from './access';
export { readableArtifact } from './read-access';
export { getArtifact, getArtifactById, getArtifactFor, getEditableArtifactFor, getLinkReadableArtifact, getOwnedArtifactFor, getVersionFor, listVersionsFor, listVersionPageFor, listArtifactPageFor, isVersionNotArchived, versionToWire } from './store';
export type { ArtifactSummary } from './store';
export { can, capabilityGuard, capabilityRefusal } from './capabilities';
export type { CapabilityActor } from './capabilities';
export { recordArtifactView } from './view-admission';
export { artifactState } from './state';

/** Write path (publish, operations, offline): create, edit, replace and revert; metadata; quotas; version conflicts; the creation ledger; id reservation; mutation receipts and operations; after-commit hooks; and the deployment's two seams. */
export { createArtifact, afterCreated, applyEditFor, replaceArtifactFor, revertArtifactFor, commitNormalizedMarkup, setMetadataFor, artifactQuotaExceeded, byteQuotaFor, isVersionConflict } from './store';
export type { ArtifactInput, PreparedMarkupWrite } from './store';
export { updateMetadataFromBody } from './metadata-wire';
export { assetByteQuotaExceeded } from './asset-quota';
export { CreationReplay, creationOperation, lookupCreation } from './creation-ledger';
export { reserveArtifactIds, reserveIds } from './identities';
export { durableMutation } from './mutation-receipt';
export type { MutationReceipt } from './mutation-receipt';
export { adaptMutationOperationReply, mutationInitiator, normalizeMutationOperation } from './mutation-operation';
export { emitHeadCommitted, onDatasetCommitted, onHeadCommitted } from './after-commit';
export { setMutationInvocation } from './mutation-invocation';
export type { MutationInvocationFactory } from './mutation-invocation';
export { setDocumentEditorPolicy } from './document-policy';
export type { DocumentEditorPolicy } from './document-policy';

/** Wire (routes, publish, operations): body parsers and the response shapes. */
export { artifactSummaryToWire, committedOpenAnnotations, createdArtifactWire, parseAccessValue, parseExpectedVersion, parseLinkRoleValue, parseParentField, parseShareEntries, parseVisibilityValue, placementFor, replacedArtifactWire, respondToEdit, respondToMutate, sourceRepairsEcho } from './wire';

/** Document dataflow (publish, offline, runner, operations, routes). */
export { compiledForRow, dataflowForRow, datasetResolverForActor, datasetsForDocument, declarationsForRow, findDependentsFor, holdImport, holdableImports, nameablePeople, refDataForRow, refLoaderForActor, rowToResolvedRef, runDocumentDataflow, runDocumentMutation, viewerIdentityFor } from './dataflow';

/** Sharing, membership, placement and dataset grants. */
export { getSharingFor, updateSharingFor } from './sharing';
export { MembershipError, changeMembership, invitePeople, membershipState, mentionCandidates, savedMentionStates } from './membership/membership';
export { membershipInbox, updateMembershipInbox } from './membership/membership-inbox';
export { accountProfile, updateAccountProfile } from './membership/account-profile';
export { isParentRefusal, resolveParent } from './placement';
export { grantsOf, grantsPermitRead, grantsPermitWrite } from './dataset-policy/grants';

/** Serving: what may be served, and archived versions. */
export { refusingUnservable, servableDocument, unservable } from './servable';
export { archivedReadOnly, servedRow } from './archived-version';
export type { ArchivedRender } from './archived-version';

/** Route adapters (one route family each). */
export { readDatasetPolicy, writeDatasetPolicy } from './dataset-policy/http';
export { resolveImageReference } from './image-references';

/** Notifications (the runtime's background tasks and the operation registry). */
export { notificationAuthority } from './notification-authority';
export { evaluateNotificationQuery } from './notification-query';
export { notificationJobStore } from './notification-runtime';

/** Table access, PROVISIONAL: callers that still query the artifacts table themselves. Narrowing this is its own redesign (workspace listings, trash, analytics, publish preparation); until then the debt stays visible here, in one place. */
export { LIVE_ARTIFACT_SQL } from './access';
export { artifactQuery, loadArtifactDocument } from './document';
