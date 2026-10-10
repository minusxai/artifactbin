/**
 * The artifacts module's whole interface. Everything outside `lib/artifacts` imports from here and
 * nothing else but the `./table` entry (DEEP_MODULES in scripts/ci/module-graph.mjs refuses any other
 * deep import); tests may import a defining file directly, so names only tests use are not listed.
 * Grouped by who calls them. A stored document's data plane (its runs, writes, dataset policies and
 * files, and notifications) is its own module above this one (document data): nothing here imports it.
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

/** Write path (publish, operations, offline): create, edit, replace and revert; metadata; quotas; version conflicts; the creation ledger; id reservation; mutation receipts; after-commit hooks; and the deployment's two seams. */
export { createArtifact, afterCreated, applyEditFor, replaceArtifactFor, revertArtifactFor, commitNormalizedMarkup, retainDownloadedVersion, setMetadataFor, artifactQuotaExceeded, byteQuotaFor, isVersionConflict } from './store';
export type { ArtifactInput, PreparedMarkupWrite } from './store';
export { updateMetadataFromBody } from './metadata-wire';
export { assetByteQuotaExceeded, assetByteQuotaLimit } from './asset-quota';
export { CreationReplay, creationOperation, lookupCreation } from './creation-ledger';
export { reserveArtifactIds, reserveIds } from './identities';
export { completeMutationReceipt, durableMutation } from './mutation-receipt';
export type { MutationReceipt } from './mutation-receipt';
export { emitHeadCommitted, onDatasetCommitted, onHeadCommitted } from './after-commit';
export { setMutationInvocation } from './mutation-invocation';
export type { MutationInvocationFactory } from './mutation-invocation';
export { setDocumentEditorPolicy } from './document-policy';
export type { DocumentEditorPolicy } from './document-policy';

/** Wire (routes, publish, operations): body parsers and the response shapes. */
export { artifactSummaryToWire, artifactToWire, committedOpenAnnotations, createdArtifactWire, parseAccessValue, parseExpectedVersion, parseLinkRoleValue, parseParentField, parseShareEntries, parseVisibilityValue, placementFor, replacedArtifactWire, respondToEdit, sourceRepairsEcho } from './wire';

/** A row compiled (publish, offline, runner, operations, routes), and what depends on a row. */
export { compiledForRow, declarationsForRow, refLoaderForActor, rowToResolvedRef } from './row-compile';
export { findDependentsFor } from './dependents';

/** Sharing, membership, placement and dataset grants. */
export { getSharingFor, updateSharingFor } from './sharing';
export { MembershipError, changeMembership, invitePeople, membershipState, mentionCandidates, savedMentionStates } from './membership/membership';
export { accountProfile, updateAccountProfile } from './membership/account-profile';
export { ancestorsForMove, isParentRefusal, notifyParent, parentOf, resolveParent, selectChildren } from './placement';
export type { Viewer } from './placement';
export { grantsOf, grantsPermitRead, grantsPermitWrite } from './dataset-policy/grants';

/** Serving: what may be served, and archived versions. */
export { UnservableDocument, refusingUnservable, servableDocument, unservable } from './servable';
export { VERSION_PARAM, archivedReadOnly, archivedVersionFor, archivedVersionForActor, servedRow } from './archived-version';
export type { ArchivedRender } from './archived-version';

/** Route adapters (one route family each). */
export { resolveImageReference } from './image-references';

/** Independent ownership destinations and atomic ownership transfer. */
export {parseArtifactDestination,newArtifactDestination} from './ownership';
export {transferArtifact} from './transfer';

/**
 * For the document data module alone (its runs, writes, policies, files and notifications stand on these):
 * the grant context and its commit check, the access facts and editor policy a read decision consults,
 * the capability refusal, the mutation context pin and invocation seam, the dataset commit emitter,
 * the compiled-row result and its error text, and the folder table.
 */
export { assertGrantCommit, grantContext, readThrough } from './dataset-policy/grants';
export type { GrantDocument, ReadRow } from './dataset-policy/grants';
export { liveAccessFacts, preloadAccessFacts } from './access-facts';
export type { AccessFacts } from './access-facts';
export { hasDocumentEditorAccess } from './document-policy';
export { refusalFor } from './capabilities';
export type { CapabilityRefusal } from './capabilities';
export { pinMutationContext } from './mutation-receipt';
export type { MutationReply } from './mutation-receipt';
export { mutationInvocation } from './mutation-invocation';
export { emitDatasetCommitted } from './after-commit';
export { compileErrorText, compileResultForRow } from './row-compile';
export { childrenTableFor } from './placement';
