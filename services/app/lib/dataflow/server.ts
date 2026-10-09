/**
 * THE DATA LANGUAGE's node-only half: the compiler that turns declarations into a `CompiledDataflow`
 * (it loads SQLite to analyze each statement) and the publish-time checks of what a document
 * references. The compiler takes the composition's SQL extensions from its caller
 * (`CompileOptions.extensions`) and never reads process state. Browser code never imports this file.
 */
export type { CompileOptions, CompileResult, ImportSource, SchemaLoader } from './compile-dataflow';
export { compileDataflow, compileWithLoader, prepareCompile } from './compile-dataflow';
export { validateDataflow } from './dataflow';
export type { RefLoader, ReferenceValidationState, ResolvedRef } from './refs';
export { collectRefUses, findBrokenEmbeds, validateRecipeUse, validateRefs, validateVizAgainstColumns, writeRefusal } from './refs';
export { DATA_SYNTAX_META, hasCurrentDataSyntax } from './data-syntax';
export { withSqliteHint } from './sqlite-hints';
export { bindParameters, datasetSqlParams } from './sql-parameters';
export { isNumberFormat, NUMBER_FORMAT_HINT } from './number-format';
