/**
 * THE STORED DOCUMENT AND ITS EDITING ALGEBRA, browser-safe: what a document is (its source and the
 * stored node graph, node identity) and how edits compose (splices, edit batches, graph patches,
 * prepared updates). No I/O. What server code outside this module imports; the Helmet-declared
 * settings are in `./head`, comment ranges in `./annotations`, the stored compiled-dataflow record in
 * `./server` (node-only). Browser-bundled code imports the leaf files directly: the island and app
 * bundlers cannot drop the rest of a barrel.
 */
export type { StoredDocument } from './document-codec';
export { graphNodes } from './document-graph';
export type { ProseOperation } from './document-prose';
export { stampNodeIds } from './node-ids';
export type { StringEdit } from './edit-batch';
export { storyBodyFor } from './body';
export { urlHash } from './asset-url';
export { collectExternalAssetUrls } from './external-images';
