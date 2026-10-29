/**
 * THE ARTIFACT STORE's whole interface: the one module that writes the `artifacts` table (scripts/ci/table-ownership.mjs).
 * It loads and writes rows; who may do what with a row is the access rule's (@/lib/artifact-access, below this module),
 * and what a route echoes and parses is the wire's (@/lib/artifact-wire, above it). Everything outside imports from
 * here and nothing else but the `./table` entry (DEEP_MODULES in scripts/ci/module-graph.mjs); tests also have
 * the `./testing` entry, for the names only tests use.
 * Grouped by who calls them. A stored document's data plane (its runs, writes, dataset policies and files, and
 * notifications) is its own module above this one (document data): nothing here imports it.
 */

/** The row every read and write answers with (the access rule defines it). */
export type { ArtifactRow } from '@/lib/artifact-access';

/** Reads (every server caller): the one read decision and the route gate, the reader snapshot, the lookups, versions and listings, and the state digest. */
export { canReadArtifact, capabilityGuard, readableArtifact, readableArtifactHeader, readableArtifactIdentity, snapshotForReader, snapshotHeadFor } from './read-access';
export { accessMoved, getArtifact, getArtifactAccessById, getArtifactById, getArtifactFor, getArtifactHeaderById, getArtifactsFor, getEditableArtifactFor, getLinkReadableArtifact, getLinkReadableArtifacts, getOwnedArtifactFor, hasInvitedUsersFor } from './rows';
export type { ArtifactHeader, ArtifactIdentity } from './rows';
export { getVersionFor, listVersionsFor, listVersionPageFor, listArtifactPageFor, isVersionNotArchived } from './store';
export type { ArtifactSummary, VersionContent } from './store';
export { artifactState } from './state';

/** Write path (publish, operations, offline): create, edit, replace and revert; metadata; quotas; version conflicts; the creation ledger; id reservation; mutation receipts; the after-commit emitter; and the deployment's two seams. */
/** Token claim and guest merge (lib/authentication), inside the caller's transaction. */
export { adoptGuestArtifacts, adoptTokenArtifacts } from './owner-adoption';
export { createArtifact, afterCreated, replaceArtifactFor, revertArtifactFor, setMetadataFor, artifactQuotaExceeded, byteQuotaFor, isVersionConflict } from './store';
export type { ArtifactInput, MetadataPatch, ReplaceOpts } from './store';
export { assetByteQuotaExceeded, assetByteQuotaLimit } from './asset-quota';
export { CreationReplay, creationOperation, lookupCreation, recoverCreationIds } from './creation-ledger';
export { reserveArtifactIds, reserveIds } from './identities';
export { completeMutationReceipt, durableMutation } from './mutation-receipt';
export type { MutationReceipt } from './mutation-receipt';
export { emitHeadCommitted } from './after-commit';
export { setMutationInvocation } from './mutation-invocation';
export type { MutationInvocationFactory } from './mutation-invocation';

/** A row compiled (publish, offline, runner, operations, routes), and what depends on a row. */
export { compiledForRow, declarationsForRow, refLoaderForActor, rowToResolvedRef } from './row-compile';
export { findDependentsFor } from './dependents';

/** Sharing, membership and placement. */
export { getSharingFor, updateSharingFor } from './sharing';
export { MembershipError, changeMembership, invitePeople, membershipState, mentionCandidates } from './membership/membership';
export { accountProfile, updateAccountProfile } from './membership/account-profile';
export { PARENT_REFUSED, isParentRefusal, notifyParent, parentOf, resolveParent, selectChildren } from './placement';
/** The trash's writes, for lib/workspace's delete and restore. */
export { rerootArtifact, restoreTrashedSubtree, trashSubtree } from './trash';

/** Serving: what may be served, and archived versions. */
export { UnservableDocument, refusingUnservable, servableDocument, unservable } from './servable';
export { VERSION_PARAM, archivedVersionFor, archivedVersionForActor, servedRow } from './archived-version';

/** Independent ownership destinations and atomic ownership transfer. */
export {parseArtifactDestination,newArtifactDestination} from './ownership';
export {transferArtifact} from './transfer';

/**
 * For the document data module alone (its runs, writes, policies, files and notifications stand on these): the
 * dataset and policy commits and the dataset commit emitter, the mutation context pin and invocation seam, the
 * compiled-row result and its error text, and the folder table.
 */
export { commitDatasetPolicy, commitDatasetWrite } from './dataset-commit';
export { pinMutationContext } from './mutation-receipt';
export type { MutationReply } from './mutation-receipt';
export { mutationInvocation } from './mutation-invocation';
export { emitDatasetCommitted } from './after-commit';
export { compileErrorText, compileResultForRow } from './row-compile';
export { childrenTableFor } from './placement';
