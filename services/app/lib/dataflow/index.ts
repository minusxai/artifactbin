/**
 * THE DATA LANGUAGE, browser-safe: the Helmet declarations (`<Import>`, `<Value>`, `<Query>`,
 * `<Mutation>`, `<Notify>`), the `CompiledDataflow` record publishing turns them into, every pure
 * question asked of one, and the evaluator that runs one against a SQL service. Code outside this
 * module imports it from here, from `./references` (the parser-backed reference uses) or from
 * `./server` (node-only); scripts/ci/module-graph.mjs DEEP_MODULES refuses any other path, except
 * that VALUE imports in the browser bundles' graphs name a leaf (DATAFLOW_BROWSER_LEAVES): a value
 * import through this barrel keeps every file it re-exports (measured: esbuild's island splitting,
 * +3.5 to +9.2 KB raw per kit, `sideEffects: false` does not change it; rolldown's app build, +10.3 KB
 * of app shell JS before the document frame). Types are erased, so browser code imports them from here.
 */

// The vocabulary: scalars, rows and tables, the declarations and the compiled record.
export type { BindingSource, ControlOption, Dataflow, DataflowState, QueryDecl, Row, Scalar, TableResult } from './dataflow';
export type { ColumnType, DatasetColumn } from './dataset-shape';
export { inferColumns } from './dataset-shape';
export type {
  CompiledDataflow, CompiledMutation, CompiledNotify, CompiledQuery, CompiledReads, CompiledValue,
} from './compiled-dataflow';
export { EMPTY_COMPILED_DATAFLOW, readerDataflow } from './compiled-dataflow';

// Reference syntax (`$name`, bindings, controls) and the declarations.
export {
  carriesRef, collectRefNameUses, controlOptions, EMPTY_DATAFLOW, isEmptyDataflow, REF_ATTRS, refName, scalarMatches,
} from './dataflow';
export { coerceScalarInput } from './scalar-input';

// Built-ins: the platform's own inputs and tables, and the reader's zone.
export { BUILTIN_INPUTS, BUILTIN_TABLES, platformValues, readerZone, rowField, VIEWER, VIEWER_ID } from './builtins';

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
export { readUrlValues, urlSelection } from './url-values';
export { validateQueryValues } from './query-values';

// The evaluator: runs a compiled dataflow's queries against a SQL service (contracts and siblings only).
export type { RunDataflowOptions } from './evaluate';
export { DataflowResultError, evaluateDataflow, evaluateDataflowMany } from './evaluate';

// Reference media (`ref:` images and files).
export type { ImageAssetAnswer, ImageRefData, RefDataMap } from './ref-data';
export { imageRefData, rawUrl, resolveRefProps } from './ref-data';
export { imageReferenceId } from './image-source';
export { REFERENCE_POSITIONS } from './reference-positions';

// Number display.
export type { NumberAgg } from './number-aggregation';
