/** DEPRECATED: GraphQL compatibility for pages published before SQL. Do not use in new code; do not extend. */
/**
 * The page and dataset GraphQL doors: every dataset link mounts the dataset's generated (Hasura-style) API, and the
 * page schema composes them with its backend files' typeDefs. Who may import this module: README.md.
 */
export {pageGraphql,resolverDatasets} from './page';
export {datasetGraphqlSchema,executeDatasetGraphql,executeLinkedDatasetGraphql,isDatasetGraphqlTarget,pageDatasetCheckSources,pageDatasetRoots} from './dataset/hasura';
