/**
 * THE DATA LANGUAGE, browser-safe: the Helmet declarations (`<Import>`, `<Value>`, `<Query>`,
 * `<Mutation>`, `<Notify>`), the `CompiledDataflow` record publishing turns them into, every pure
 * question asked of one, and the evaluator that runs one against a SQL service. Code outside this
 * module imports it from here, from `./references` (the parser-backed reference uses) or from
 * `./server` (node-only); scripts/ci/module-graph.mjs DEEP_MODULES refuses any other path, except
 * that the island graph's VALUE imports name a leaf (DATAFLOW_BROWSER_LEAVES): esbuild splits the
 * islands by which entries reach a FILE, so a value import through this barrel puts every file it
 * re-exports into that island's closure (+3.5 to +9.2 KB raw per kit, measured; `sideEffects: false`
 * does not change it). Types are erased, so the island graph imports them from here.
 */

// The vocabulary: scalars, rows and tables, the declarations and the compiled record.
export type { BindingSource, ControlOption, Dataflow, DataflowState, QueryDecl, Row, Scalar, TableResult } from './dataflow';
export type { ColumnType, DatasetColumn } from './dataset-shape';
export { inferColumns } from './dataset-shape';
export type {
  CompiledDataflow, CompiledMutation, CompiledNotify, CompiledQuery, CompiledReads, CompiledValue,
} from './compiled-dataflow';
export { EMPTY_COMPILED_DATAFLOW, readerDataflow } from './compiled-dataflow';

// Reference syntax (`$name`, bindings, controls) and the declarations' shapes.
export type { ImportDecl, MutationDecl, NotifyDecl, ValueDecl } from './dataflow';
export {
  ARGS_ATTR, bindingMap, carriesRef, collectRefNameUses, controlOptions, EMPTY_DATAFLOW, isEmptyDataflow, QUERY_TAG, REF_ATTRS,
  refName, rowBound, scalarMatches, SET_ATTR, validateDataflow,
} from './dataflow';
export { coerceScalarInput } from './scalar-input';

// Built-ins: the platform's own inputs and tables, and the reader's zone.
export { BUILTIN_INPUTS, BUILTIN_TABLES, localZone, platformValues, readerZone, rowField, VIEWER, VIEWER_ID } from './builtins';

// Questions asked of a compiled dataflow.
export type { ImportTables } from './compiled-flow';
export {
  bindParams, bindTypes, dataRefs, importRef, initialTables, initialValues, mutationParams, mutationReads, mutationTargetRef,
  queriesReadingValues, selectQueries, valueTypes,
} from './compiled-flow';

// Placement: what runs on the server, in the reader, or is held.
export type { DataflowPlacement } from './placement';
export { HOLD_MAX_BYTES, HOLD_MAX_ROWS, placeDataflow } from './placement';

// Mutation requests and the reader's local state.
export type { MutationRequest } from './mutation-request';
export { bindMutationRequest, parseMutationRequest } from './mutation-request';
export type { LocalMutationResult } from './local-state';
export { runLocalStateMutation } from './local-state';
export { LocalStateInputError, localTableOverrides, parseLocalTables } from './local-tables';

// URL values and query values.
export { readUrlValues, urlSelection, withUrlValuesOf } from './url-values';
export { validateQueryValues } from './query-values';

// The evaluator: runs a compiled dataflow's queries against a SQL service (contracts and siblings only).
export type { RunDataflowOptions } from './evaluate';
export { DataflowResultError, evaluateDataflow, evaluateDataflowMany } from './evaluate';

// Reference media (`ref:` images and files).
export type { ImageAssetAnswer, ImageRefData, RefDataMap } from './ref-data';
export { imageRawUrl, imageRefData, pdfRawUrl, resolveRefProps } from './ref-data';
export { imageReferenceId } from './image-source';
export { REFERENCE_POSITIONS } from './reference-positions';

// Number display.
export type { NumberAgg } from './number-aggregation';
export { NUMBER_AGGS } from './number-aggregation';
export { numberFormatter } from './number-format';
