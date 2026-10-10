/**
 * The artifacts module's whole interface. Everything outside `lib/artifacts` imports from here and
 * nothing else (DEEP_MODULES in scripts/ci/module-graph.mjs refuses a deep import); tests may import a
 * defining file directly, so names only tests use are not listed. Grouped by who calls them.
 */

/** Reads and access (every server caller): the row, the role decision and its scopes, the reader snapshot, the lookups, versions and listings, capabilities, views and the state digest. */
export { canReadArtifact, ownsArtifact, roleFor, effectiveRole, isOwner } from './access';
export { commentMonitorScope, annotationScope, editorScope, writerFor } from './table';
export type { ArtifactRow, Scope } from './table';
export { readableArtifact, snapshotForReader, snapshotHeadFor } from './read-access';
export { getArtifact, getArtifactById, getArtifactFor, getEditableArtifactFor, getLinkReadableArtifact, getOwnedArtifactFor } from './rows';
export { getVersionFor, listVersionsFor, listVersionPageFor, listArtifactPageFor, isVersionNotArchived, versionToWire } from './store';
export type { ArtifactSummary } from './store';
export { can, capabilityGuard, capabilityRefusal } from './capabilities';
export type { CapabilityActor } from './capabilities';
export { recordArtifactView } from './view-admission';
export { artifactState } from './state';

/** Write path (publish, operations, offline): create, edit, replace and revert; metadata; quotas; version conflicts; the creation ledger; id reservation; mutation receipts and operations; after-commit hooks; and the deployment's two seams. */
export { createArtifact, afterCreated, applyEditFor, replaceArtifactFor, revertArtifactFor, commitNormalizedMarkup, retainDownloadedVersion, setMetadataFor, artifactQuotaExceeded, byteQuotaFor, isVersionConflict } from './store';
export type { ArtifactInput, PreparedMarkupWrite } from './store';
export { updateMetadataFromBody } from './metadata-wire';
export { assetByteQuotaExceeded, assetByteQuotaLimit } from './asset-quota';
export { CreationReplay, creationOperation, lookupCreation } from './creation-ledger';
export { reserveArtifactIds, reserveIds } from './identities';
export { completeMutationReceipt, durableMutation } from './mutation-receipt';
export type { MutationReceipt } from './mutation-receipt';
export { adaptMutationOperationReply, mutationInitiator, normalizeMutationOperation } from './mutation-operation';
export { emitHeadCommitted, onDatasetCommitted, onHeadCommitted } from './after-commit';
export { setMutationInvocation } from './mutation-invocation';
export type { MutationInvocationFactory } from './mutation-invocation';
export { setDocumentEditorPolicy } from './document-policy';
export type { DocumentEditorPolicy } from './document-policy';

/** Wire (routes, publish, operations): body parsers and the response shapes. */
export { artifactSummaryToWire, artifactToWire, committedOpenAnnotations, createdArtifactWire, parseAccessValue, parseExpectedVersion, parseLinkRoleValue, parseParentField, parseShareEntries, parseVisibilityValue, placementFor, replacedArtifactWire, respondToEdit, respondToMutate, sourceRepairsEcho } from './wire';

/** Document dataflow (publish, offline, runner, operations, routes). */
export { acceptedMembers, dataflowForRow, dataflowRunsForRow, datasetResolverForActor, datasetsForDocument, holdImport, holdableImports, importsFingerprint, nameablePeople, refDataForRow, referencedArtifactForRow, runDocumentDataflow, runDocumentMutation, viewerIdentityFor } from './dataflow';
export { compiledForRow, declarationsForRow, refLoaderForActor, rowToResolvedRef } from './row-compile';
export { findDependentsFor } from './dependents';
export type { ImportCache } from './dataflow';

/** Sharing, membership, placement and dataset grants. */
export { getSharingFor, updateSharingFor } from './sharing';
export { MembershipError, changeMembership, invitePeople, membershipState, mentionCandidates, savedMentionStates } from './membership/membership';
export { membershipInbox, updateMembershipInbox } from './membership/membership-inbox';
export { accountProfile, updateAccountProfile } from './membership/account-profile';
export { ancestorsForMove, isParentRefusal, notifyParent, parentOf, resolveParent, selectChildren } from './placement';
export type { Viewer } from './placement';
export { grantsOf, grantsPermitRead, grantsPermitWrite } from './dataset-policy/grants';

/** Serving: what may be served, and archived versions. */
export { UnservableDocument, refusingUnservable, servableDocument, unservable } from './servable';
export { VERSION_PARAM, archivedReadOnly, archivedVersionFor, archivedVersionForActor, servedRow } from './archived-version';
export type { ArchivedRender } from './archived-version';

/** Route adapters (one route family each). */
export { readFileRequest, uploadFileRequest } from './file-upload-http';
export { readDatasetImage, uploadDatasetImage } from './feedback-images';
export { datasetPolicyRequest, readDatasetPolicy, writeDatasetPolicy } from './dataset-policy/http';
export { resolveImageReference } from './image-references';

/** Notifications (the runtime's background tasks and the operation registry). */
export { notificationAuthority } from './notification-authority';
export { evaluateNotificationQuery } from './notification-query';
export { notificationJobStore } from './notification-runtime';

/** Table access, PROVISIONAL: callers that still query the artifacts table themselves. Narrowing this is its own redesign (workspace listings, trash, analytics, publish preparation); until then the debt stays visible here, in one place. */
export { LIVE_ARTIFACT_SQL, ownerPredicate } from './table';
export { artifactQuery, loadArtifactDocument } from './document';

/** Independent ownership destinations and atomic ownership transfer. */
export {parseArtifactDestination,newArtifactDestination} from './ownership';
export {transferArtifact} from './transfer';
