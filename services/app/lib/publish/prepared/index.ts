/**
 * What server code outside lib/publish imports from this sub-module: a document's prepared page, the compiled reader
 * served from it (serve.server) and the guest snapshots kept of it (snapshots.server). Server-only; browser-bundled
 * code imports the leaf files directly: the island and app bundlers cannot drop the rest of a barrel.
 */
export { compiledPageFor, domainFooter } from './serve.server';
export { anonymousAccessFacts, enableSnapshotRevalidations } from './snapshots.server';
export { installStoryCommitHooks } from './commit-hooks.server';
