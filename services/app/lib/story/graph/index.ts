/** What server code outside lib/story imports from this sub-module. Browser-bundled code imports the leaf files directly: the island and app bundlers cannot drop the rest of a barrel. */
export { applyGraphPatch } from './document-graph-patch';
export { createDocumentGraph, graphNodes, graphSource } from './document-graph';
export type { GraphAstNode } from './document-graph';
export type { ProseOperation } from './document-prose';
export { needsAuthoringContext, prepareClientDocumentReplacement } from './document-update-client';
export { documentAfterOperation } from './document-update-history';
