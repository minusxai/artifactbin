/**
 * THE DATA LANGUAGE's node-only half: the compiler that turns declarations into a `CompiledDataflow`
 * (it loads SQLite to analyze each statement) and the publish-time checks of what a document
 * references. The compiler takes the composition's SQL extensions from its caller
 * (`CompileOptions.extensions`) and never reads process state. Browser code never imports this file.
 */
export { compileWithLoader } from './compile-dataflow';
export { collectRefUses } from './refs';
