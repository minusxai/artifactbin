/**
 * THE DATA LANGUAGE, browser-safe: the Helmet declarations (`<Import>`, `<Value>`, `<Query>`,
 * `<Mutation>`, `<Notify>`), the `CompiledDataflow` record publishing turns them into, and every pure
 * question asked of one — what a reader binds, what runs where, what a mutation request carries,
 * which URL values select what. What server code outside this module imports; the compiler and the
 * reference checks are in `./server` (node-only). Browser-bundled code imports the leaf files
 * directly: the island and app bundlers cannot drop the rest of a barrel.
 */
export type { DataflowState, Row, Scalar, TableResult } from './dataflow';
export type { DatasetColumn } from './dataset-shape';
export { BUILTIN_INPUTS, BUILTIN_TABLES, platformValues } from './builtins';
export type { CompiledDataflow, CompiledNotify } from './compiled-dataflow';
export type { ImportTables } from './compiled-flow';
export { selectQueries } from './compiled-flow';
export { placeDataflow } from './placement';
export type { MutationRequest } from './mutation-request';
export { parseMutationRequest } from './mutation-request';
export { LocalStateInputError } from './local-tables';
export { validateQueryValues } from './query-values';
export type { ImageRefData, RefDataMap } from './ref-data';
export { imageRefData } from './ref-data';
export { imageReferenceId } from './image-source';
export { readUrlValues, urlSelection } from './url-values';
