/**
 * What server code outside lib/story imports from this sub-module: a document's prepared page, the compiled reader
 * served from it (serve.server) and the guest snapshots kept of it (snapshots.server). Server-only; browser-bundled
 * code imports the leaf files directly: the island and app bundlers cannot drop the rest of a barrel.
 */
export { preparedPageFor, recompilePage, servedPage, warmPreparedPage, type PreparedPage } from './prepared-page.server';
export { marksOf, SERVED_RESULTS_BUDGET_MS, tokenOf } from './served-results.server';
export { compiledPageFor, domainFooter, type CompiledReaderAnswer, type CompiledReaderRequest } from './serve.server';
export { anonymousAccessFacts, enableSnapshotRevalidations, snapshotStore } from './snapshots.server';
export { installStoryCommitHooks } from './commit-hooks.server';
