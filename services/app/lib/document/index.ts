/**
 * THE STORED DOCUMENT AND ITS EDITING ALGEBRA, browser-safe: what a document is (its source and the
 * stored node graph, node identity) and how edits compose (splices, edit batches, graph patches,
 * prepared updates). No I/O. What server code outside this module imports; the Helmet-declared
 * settings are in `./head`, comment ranges in `./annotations`, the stored compiled-dataflow record in
 * `./server` (node-only). Browser-bundled code imports the leaf files directly: the island and app
 * bundlers cannot drop the rest of a barrel.
 */
export type { StoredDocument } from './document-codec';
export { decodeDocument } from './document-codec';
export type { DocumentGraph, DocumentGraphNode } from './document-graph';
export { createDocumentGraph, GRAPH_POLICY, GRAPH_ROOT, graphIntegrity, graphNodes, graphReferences, graphSource } from './document-graph';
export { graphFromSource } from './document-graph-source';
export type { GraphValidationScope } from './document-graph-scope';
export { graphValidationScope } from './document-graph-scope';
export type { GraphPatch } from './document-graph-patch';
export { applyGraphPatch, prepareGraphPatch } from './document-graph-patch';
export { applyOperationsToNodes, DocumentOperationError } from './document-operation';
export type { ProseOperation } from './document-prose';
export type { DocumentOperationHistory } from './document-update-history';
export { documentAfterOperation, documentBeforeOperation } from './document-update-history';
export { nodeIndex, normalizeNodeIds, stampNodeIds } from './node-ids';
export type { BatchChange, StringEdit } from './edit-batch';
export { rebaseEditBatch, resolveEditBatch } from './edit-batch';
export type { EditRecord } from './splice';
export { newEditId } from './splice';
export { sourceChanges } from './source-changes';
export { bodyPathToSourcePath, composeSource, sourcePathToBodyPath } from './edit-compose';
export { fixHtmlNesting } from './nesting';
export { canonicalizeMarkup } from './canonical-source';
export { formatMarkupSource } from './format-source';
export { validateMarkupStructure } from './local-validation';
export type { ClientDocumentChange, ClientDocumentSnapshot } from './document-update-client';
export { attachAuthoringContext, needsAuthoringContext, prepareClientDocument, prepareClientDocumentPublication, prepareClientDocumentReplacement, prepareClientDocumentUpdate } from './document-update-client';
export { storyBodyFor } from './body';
export { storyUpdateParts } from './update-parts';
export { urlHash } from './asset-url';
export { collectExternalAssetUrls } from './external-images';
