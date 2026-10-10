/**
 * THE DATA LANGUAGE's node-only half: the compiler that turns declarations into a `CompiledDataflow`
 * (it loads SQLite to analyze each statement), the publish-time reference checks, the data-syntax
 * stamp and the dataset SQL parameter lexer. The compiler takes the composition's SQL extensions
 * from its caller (`CompileOptions.extensions`) and never reads process state. Browser code never
 * imports this file; everything browser-safe is in `./index`.
 */
export type { CompileOptions, CompileResult, ImportSource, SchemaLoader } from './compile-dataflow';
export { compileDataflow, compileWithLoader, prepareCompile, rewriteBuiltinFields } from './compile-dataflow';
export type { BoundColumn, RefLoader, ReferenceValidationState, ResolvedRef } from './refs';
export { refId, validateRecipeUse, validateRefs, validateVizAgainstColumns, writeRefusal } from './refs';
export { DATA_SYNTAX_META, hasCurrentDataSyntax } from './data-syntax';
export { bindParameters, datasetSqlParams } from './sql-parameters';
