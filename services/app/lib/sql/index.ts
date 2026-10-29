/** The sql module's interface: what code outside lib/sql imports (rule 4, scripts/ci/module-graph.mjs). */
export { isQueryFailure, runMutation, runQueries } from './engine';
export type { MutationInput } from './engine';
export { sqlExtensions, useSqlExtensions } from './extensions';
export { runDataflow } from './run-dataflow';
export type { RunDataflowOptions } from './run-dataflow';
