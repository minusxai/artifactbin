/**
 * DATASET PERMISSIONS AT RUN TIME: the caller's dataset role (./role `datasetRole`; `pageRole`, the same derivation
 * over a page's sharing, is what resolver `@auth` reads), the stored version 3 policy as every decision reads it
 * (./stored-policy `storedPolicy`), the one read decision and role view every row-reading door asks (./read,
 * ./view), and the one write decision every write door and commit asks (./write).
 * Pure grammar, validation, read-back and templates live in @artifactbin/utils/dataset-permissions; the role
 * lattice and its derivation in @artifactbin/contracts. Entered only through this index.
 */
export {
  canRunSql, datasetExportable, datasetReadAccess, datasetRowsFor, datasetView, sqlRefusal, sqlRefusalMessage, viewCatalog, viewDatasetWire, type DatasetReadDecision,
} from './read';
export { storedPolicy, type StoredPolicy } from './stored-policy';
export { filterAdmits } from './view';
export { assertWriteCommit, canInsert, canUpdateCell, cellCheckAdmits, datasetWriteAccess, tableMutationPolicy, type DatasetWriteOptions } from './write';
export { datasetRole, pageRole } from './role';
