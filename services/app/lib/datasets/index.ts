/** The datasets module's interface: what code outside lib/datasets imports (rule 4, scripts/ci/module-graph.mjs). */
export { LIVE_DATASET_REFUSAL, liveConnectionOf } from './catalog-metadata';
export { LIVE_QUERY_TABLE, liveQueryRoles, liveRulesProblems } from './policy/live-rules';
export { catalogOf, importedRows, importedTables, prepareCatalog, publicCatalogOf } from './catalog';
export { publishDataset, publishImage, publishPdf, publishVizRecipe, storeImageContent, storePdfContent } from './data-tiers';
export { loadDatasetRows, storeDatasetRows, storedRowCount } from './dataset-store';
export { datasetCreateFields } from './dataset-usage';
export { serializeDatasetDefinition } from './definition';
export { DatasetError } from './errors';
export { CatalogQueryFailure, executeCatalog, executeMounted, mutateMounted, readMountRows, type CatalogMount } from './execute';
export { publishFile, readFileUpload, serveStoredFile, storeFileContent, uploadedSha256 } from './file-store';
export { datasetResponse } from './http';
export { storedMediaReferences } from './media-references';
export { throttlePublicMutation } from './policy/usage';
export { keepDatasetConfiguration, LEGACY_POLICY_REFUSED, readOnlyDatasetPolicy, validateDatasetPolicyForRow, validateStoredDatasetPolicy } from './policy/validation';
export type { ServerRefLoader } from './asset-reference';
export type {
  CatalogInput, CatalogRowView, DatasetCatalog, DatasetTable,
} from './types';
export { people, resolveDefinitionScope, resolveUserColumnScope, retainUserScope, userOptions, validateUserContent, validateUserWrites } from './user-fields';

export { selectSqlLinks } from './sql-links';
