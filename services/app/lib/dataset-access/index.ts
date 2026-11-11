/**
 * The datasets a page reads and writes, below every door: link authority, the per-request load and its table model,
 * the retained read port, cells, permissions, and the page SQL door. Nothing here is GraphQL (lib/graphql-compat is
 * the deprecated GraphQL layer over it).
 *
 * Two GraphQL names remain on purpose: the table model keeps its generated-API names (`root`, a column's `field`)
 * because published pages' GraphQL schemas are generated from them, and SQL refusals still travel as `graphql`'s
 * `GraphQLError` with `extensions.code`, the carrier the compatibility layer passes on. Both are kept so no published
 * page changes behaviour.
 */
export {authorizeDatasetBinding,datasetBindingCatalog,DatasetBindingUnsupportedError,resolveDatasetBinding} from './authority';
export {columnsOf,fenced,linkedRoot,load,loadLinked,notFound,refusal,type Loaded,type LoadedTable,type PageCommitGuard,type PageScope} from './linked';
export type {HasuraColumn,HasuraRowCan,HasuraScalar,HasuraTableModel} from './table-model';
export {ID_COLUMN,rowIdsForObject,tableIdentity} from './model';
export {authorityShape,readAuthorityIn,rowsNow,shownRows,type ReadAuthority,type WrittenOutcome} from './write-reply';
export type {DatasetSnapshot,DatasetStatement} from './types';
export {runPageSql,type PageSqlAnswer,type PageSqlCall} from './page-sql';
export {executePageSql} from './page-sql-door';
export {offlinePageSqlData} from './offline-sql';
export {datasetPermissionTemplates,readDatasetPermissions,writeDatasetPermissions} from './policy';
export {locateDatasetCell,writeDatasetCells,type DatasetCell} from './cells';
export type {LocalDatasetTable} from './local-types';
