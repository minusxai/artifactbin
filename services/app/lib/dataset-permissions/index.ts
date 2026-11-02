/**
 * DATASET PERMISSIONS AT RUN TIME: the caller's dataset role (./role `datasetRole`; `pageRole`, the same derivation
 * over a page's sharing, is what resolver `@auth` reads), stored policies read as v3 (./to-v3 `toV3`, the dual
 * read), the one read decision and role view every row-reading door asks (./read, ./view), and the one write
 * decision every write door and commit asks (./write).
 * Pure grammar, validation, read-back and templates live in @artifactbin/utils/dataset-permissions; the role
 * lattice and its derivation in @artifactbin/contracts. Entered only through this index.
 */
export {
  canAggregate, datasetExportable, datasetReadAccess, datasetRowsFor, datasetView, viewCatalog, viewDatasetWire, type DatasetReadDecision,
} from './read';
export { assertWriteCommit, canInsert, datasetWriteAccess, tableMutationPolicy, type DatasetWriteOptions } from './write';
export { pageRole } from './role';
