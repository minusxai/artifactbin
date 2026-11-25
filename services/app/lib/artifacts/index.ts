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
export { admitRead, canReadArtifact, capabilityGuard, readableArtifact, readableArtifactHeader, readableArtifactIdentity, snapshotForReader, snapshotHeadFor } from './read-access';
export { accessMoved, getArtifactAccessById, getArtifactById, getArtifactFor, getArtifactHeaderById, getArtifactHeadersByIds, getEditableArtifactFor, getLinkReadableArtifact, getOwnedArtifactFor, getSharingArtifactFor, hasInvitedUsersFor } from './rows';
export type { ArtifactHeader } from './rows';
export { getVersionFor, listVersionsFor, listVersionPageFor, listArtifactPageFor, isVersionNotArchived } from './store';
export type { ArtifactSummary, VersionContent } from './store';
export { artifactState, versionConflictFor } from './state';
/** The page every read serves: the saved source with its regions' unsaved live text composed in, and its live revision. */
export { currentPage, readPageHeader, readPageRow, type PageRead } from './current-page';
export { slugAddress, slugAddressTarget } from './slug-address';

/** Write path (publish, operations, offline): create, edit, replace and revert; metadata; quotas; version conflicts; the creation ledger; id reservation; mutation receipts; and the deployment's two seams. */
/** Token claim and guest merge (lib/authentication), inside the caller's transaction. */
export { saveLiveDatasetConnection, type LiveConnectionInsert } from './store';
export { createArtifact, replaceArtifactFor, revertArtifactFor, setMetadataFor, artifactQuotaExceeded, publicationCountQuotaExceeded, publisherByteQuota, isVersionConflict } from './store';
export type { ArtifactInput, MetadataPatch, ReplaceOpts } from './store';
/** Live regions as page storage (lib/region-sessions): the editable head, the region rows and the save as a version. */
export { checkpointLiveRegions, saveLiveRegionsInTx } from './store';
export { editablePage, liveRegionDoc, lockedRegionRows, openPageRegion, recordRegionOpen, recordRegionUpdate, readRegionSnapshot, regionUpdatesAfter } from './regions';
export { cleanCellRegion, closeCellRegion, commitCellRegions, openCellRegion, reconcileCellRegion, saveIsDue } from './regions';
export type { RegionRow, SaveDue } from './regions';
export { assetByteQuotaExceeded, assetByteQuotaLimit } from './asset-quota';
/** The web images a page serves on its owner's host (meta.webAssets), derived at every content write. */
export { CreationReplay, prepareCreation, recoverCreationIds } from './creation-ledger';
export { reserveIds } from './identities';
export { completeMutationReceipt, durableMutation } from './mutation-receipt';
export type { MutationReceipt } from './mutation-receipt';
export { setMutationInvocation } from './mutation-invocation';
export type { MutationInvocationFactory } from './mutation-invocation';

/** A row compiled (publish, offline, runner, operations, routes), and what depends on a row. */
export { refLoaderForActor } from './reference-loader';
export { findDependentsFor } from './dependents';

/** Sharing, membership and placement. */
export { getSharingFor, updateSharingFor,setArtifactGroupShare } from './sharing';
export { MembershipError, changeMembership, invitePeople, membershipState, mentionCandidates } from './membership/membership';
export { accountProfile, updateAccountProfile } from './membership/account-profile';
export { PARENT_REFUSED, isParentRefusal, notifyParent, listedFolderChild, parentOf, resolveParent, selectChildren } from './placement';
/** The trash's writes, for lib/workspace's delete and restore. */
export { rerootArtifact, restoreTrashedSubtree, trashSubtree } from './trash';

/** Serving: what may be served, and archived versions. */
export { UnservableDocument, refusingUnservable, servableDocument, unservable } from './servable';
export { VERSION_PARAM, archivedVersionFor, servedRow } from './archived-version';

/** Independent ownership destinations and atomic ownership transfer. */
export {parseArtifactDestination,newArtifactDestination,permitsMemberPage,ArtifactParentRefusal,GroupPersonalDestination} from './ownership';
export {transferArtifact} from './transfer';
export {TransferConflict} from './transfer-dependencies';

/**
 * For the document data module alone (its runs, writes, policies, files and notifications stand on these): the
 * dataset and policy commits and the dataset commit emitter, the mutation context pin and invocation seam, the
 * compiled-row result and its error text, and the folder table.
 */
export { commitDatasetPolicy, commitDatasetWrite } from './dataset-commit';
export type { MutationReply } from './mutation-receipt';
export { mutationInvocation } from './mutation-invocation';
export { childrenTableFor } from './placement';

export {migrateLegacyPage} from './store';

