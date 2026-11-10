/** The page and dataset GraphQL door: every dataset link mounts the dataset's generated (Hasura-style) API. */
export {authorizeDatasetBinding,DatasetBindingUnsupportedError} from './authority';
export {datasetGraphqlSchema,executeDatasetGraphql,executeLinkedDatasetGraphql,isDatasetGraphqlTarget,loadPageDatasets,pageDatasetCheckSources,pageDatasetRoots,type PageCommitGuard,type PageDatasets} from './hasura';
export {planLinkedDatasetTables} from './sql-read';
export {datasetPermissionTemplates,readDatasetPermissions,writeDatasetPermissions} from './policy';
export {locateDatasetCell,writeDatasetCells,type DatasetCell} from './cells';
export {executePageSql} from './page-sql-door';
