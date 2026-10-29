/** The datasets module's interface: what code outside lib/datasets imports (rule 4, scripts/ci/module-graph.mjs). */
export { catalogOf, importedRows, importedTables, prepareCatalog, publicCatalogOf } from './catalog';
export { publishDataset, publishImage, publishPdf, publishVizRecipe, storeImageContent, storePdfContent } from './data-tiers';
export { loadDatasetRows, storeDatasetRows, storedRowStats } from './dataset-store';
export { datasetCreateFields } from './dataset-usage';
export { parseDatasetDefinition, serializeDatasetDefinition } from './definition';
export { executeDocumentQueries } from './document-queries';
export type { DocumentQuerySource, DocumentQuerySourceMode } from './document-queries';
export { DatasetError } from './errors';
export { executeCatalog } from './execute';
export { publishFile, readFileUpload, serveStoredFile, storeFileContent, uploadedSha256 } from './file-store';
export { datasetResponse } from './http';
export { imageInsertAllowed } from './image-upload-policy';
export { connectionShape, secretTargetShape } from './input';
export { storedMediaReferences } from './media-references';
export { compileNotebookSql } from './notebook';
export { throttlePublicMutation } from './policy/usage';
export { validateDatasetPolicyForRow } from './policy/validation';
export { placeholderSession, policySession, viewerMutationPolicy } from './policy/viewer-policy';
export { discoverPostgres, queryPostgres } from './postgres';
export { schemaLoaderFor } from './schema-loader';
export type { ServerRef, ServerRefLoader } from './schema-loader';
export { datasetSecretTargetHash, openDatasetSecret, sealDatasetSecret } from './secret-crypto';
export { claimPendingDatasetSecret, createDatasetSecret, resolveDatasetConnection } from './secrets';
export type {
  CatalogInput, DatasetCatalog, DatasetConnection, DatasetNotebook, DatasetTable, DiscoveredTable, NotebookCell,
} from './types';
export { people, resolveUserColumnScope, retainUserScope, userOptions, validateUserContent, validateUserWrites } from './user-fields';
