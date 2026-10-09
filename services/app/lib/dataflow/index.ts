/**
 * THE DATA LANGUAGE, browser-safe: the Helmet declarations (`<Import>`, `<Value>`, `<Query>`,
 * `<Mutation>`, `<Notify>`), the `CompiledDataflow` record publishing turns them into, and every pure
 * question asked of one — what a reader binds, what runs where, what a mutation request carries,
 * which URL values select what. What server code outside this module imports; the compiler and the
 * reference checks are in `./server` (node-only). Browser-bundled code imports the leaf files
 * directly: the island and app bundlers cannot drop the rest of a barrel.
 */
export type { BindingSource, ControlOption, Dataflow, DataflowState, Row, Scalar, TableResult } from './dataflow';
export { ARGS_ATTR, bindingMap, carriesRef, collectRefNameUses, controlOptions, refName, REF_ATTRS, resolveBindings, rowBound, SET_ATTR } from './dataflow';
export { coerceScalarInput } from './scalar-input';
export type { ColumnType, DatasetColumn } from './dataset-shape';
export { inferColumns } from './dataset-shape';
export { BUILTIN_INPUTS, BUILTIN_TABLES, platformValues, readerZone, rowField, VIEWER, VIEWER_ID } from './builtins';
export type { CompiledDataflow, CompiledMutation, CompiledNotify, CompiledQuery, CompiledReads, CompiledValue } from './compiled-dataflow';
export { EMPTY_COMPILED_DATAFLOW, readerDataflow } from './compiled-dataflow';
export type { ImportTables } from './compiled-flow';
export { bindParams, bindTypes, dataRefs, importRef, initialTables, initialValues, mutationReads, mutationTargetRef, queriesReadingValues, selectQueries, typedResult, valueTypes } from './compiled-flow';
export type { DataflowPlacement } from './placement';
export { placeDataflow } from './placement';
export type { MutationRequest } from './mutation-request';
export { bindMutationRequest, mutationRequestFor, parseMutationRequest } from './mutation-request';
export type { LocalMutationResult } from './local-state';
export { runLocalStateMutation } from './local-state';
export { localTableOverrides, LocalStateInputError } from './local-tables';
export { validateQueryValues } from './query-values';
export type { ImageRefData, RefDataMap } from './ref-data';
export { imageRefData, resolveRefProps } from './ref-data';
export { imageReferenceId } from './image-source';
export { readUrlValues, urlSelection, urlValueParams, writeUrlValues } from './url-values';
export { aggregateNumber, NUMBER_AGGS } from './number-aggregation';
export { numberFormatter } from './number-format';
