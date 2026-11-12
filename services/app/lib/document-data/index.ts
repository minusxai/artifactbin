/**
 * Dataset reads and SQL writes, the dataset policies and the dataset file and image doors. Above lib/artifacts (it reads rows, grants and access there; nothing
 * there imports this). Everything outside imports from here and nothing else (DEEP_MODULES in
 * scripts/ci/module-graph.mjs); tests may import a defining file directly. Grouped by who calls them.
 */

/** Reader runs (offline, publish/prepared, routes, runner, serving, export). */
export { datasetResolverForActor, referencedArtifactForRow } from './dataflow';

/** Writes (the mutate route, operations, runner). */
export { respondToMutate } from './mutate-http';
export { adaptMutationOperationReply, normalizeMutationOperation } from './mutation-operation';

/** Dataset policies (the policy routes). */
export { writeDatasetPolicy } from './dataset-policy/http';

/** Dataset files and images (four routes). */
export { readFileRequest, uploadFileRequest } from './dataset-files/file-upload-http';
export { readDatasetImage, uploadDatasetImage } from './dataset-files/feedback-images';

/** Native dataset GraphQL shares the retained write and policy boundary. */
export {mutateDataset,isMutationRefused,type MutationStep} from './dataset-mutate';
export {canWriteDataset} from './dataset-policy';
