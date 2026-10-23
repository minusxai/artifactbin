/**
 * A STORED DOCUMENT'S DATA, run: the reads its readers see, the writes its declared mutations and the
 * owner's dataset door make, the dataset policies and the dataset file and image doors, and the
 * notifications a mutation fires. Above lib/artifacts (it reads rows, grants and access there; nothing
 * there imports this). Everything outside imports from here and nothing else (DEEP_MODULES in
 * scripts/ci/module-graph.mjs); tests may import a defining file directly. Grouped by who calls them.
 */

/** Reader runs (offline, publish/prepared, routes, runner, serving, export). */
export { dataflowForRow, datasetResolverForActor, datasetsForDocument, holdImport, nameablePeople, refDataForRow, referencedArtifactForRow, runDocumentDataflow } from './dataflow';

/** Writes (the mutate route, operations, runner). */
export { runDocumentMutation } from './dataflow';
export { respondToMutate } from './mutate-http';
export { adaptMutationOperationReply, mutationInitiator, normalizeMutationOperation } from './mutation-operation';

/** Dataset policies (the policy routes). */
export { datasetPolicyRequest, readDatasetPolicy, writeDatasetPolicy } from './dataset-policy/http';

/** Dataset files and images (four routes). */
export { readFileRequest, uploadFileRequest } from './dataset-files/file-upload-http';
export { readDatasetImage, uploadDatasetImage } from './dataset-files/feedback-images';

/** Notifications (the runtime's background tasks, the people and notifications routes, the operation registry). */
export { evaluateNotificationQuery } from './notifications/query';
export { notificationAuthority } from './notifications/authority';
export { notificationJobStore } from './notifications/runtime';
export { membershipInbox, updateMembershipInbox } from './notifications/membership-inbox';

/** Native dataset GraphQL shares the retained write and policy boundary. */
export {mutateDataset,isMutationRefused} from './dataset-mutate';
export {canWriteDataset,canUseDataPolicy} from './dataset-policy';
