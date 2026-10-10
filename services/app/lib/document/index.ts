/**
 * THE STORED DOCUMENT, browser-safe: the one entry for code outside this module that is not
 * browser-bundled. Every name below is one a caller outside imports, grouped by what callers use it for.
 * The node-only half (the stored compiled-dataflow record: node:crypto, zod) is `./server`.
 *
 * Browser-bundled code imports the leaf files directly instead: the island and app bundlers cannot drop
 * the rest of a barrel. `scripts/ci/module-graph.mjs` (DEEP_MODULES['lib/document']) refuses any other
 * outside path, so a new name is a reviewed line here.
 */

// ---- Model: the stored node graph, node ids, the source form and its checks.
export type { DocumentGraph } from './document-graph';
export { createDocumentGraph, GRAPH_POLICY, GRAPH_ROOT, graphIntegrity, graphNodes, graphSource } from './document-graph';
export type { GraphPatch } from './document-graph-patch';
export { applyGraphPatch } from './document-graph-patch';
export { documentPatchStepSql } from './document-patch';
export type { ProseOperation } from './document-prose';
export type { StoredDocument } from './document-codec';
export { decodeDocument } from './document-codec';
export { nodeIndex, normalizeNodeIds, stampNodeIds } from './node-ids';
export type { StoredContent } from './stored-content';
export { storyBodyFor } from './body';
export { canonicalizeMarkup } from './canonical-source';
export { formatMarkupSource } from './format-source';
export { validateMarkupStructure } from './local-validation';
export { fixHtmlNesting } from './nesting';

// ---- Edits: splices, edit batches, source changes and prepared updates.
export type { EditRecord } from './splice';
export { newEditId } from './splice';
export type { StringEdit } from './edit-batch';
export { rebaseEditBatch } from './edit-batch';
export { sourcePathToBodyPath } from './edit-compose';
export { sourceChanges } from './source-changes';
export type { ClientDocumentSnapshot } from './document-update-client';
export { attachAuthoringContext, prepareClientDocument, prepareClientDocumentPublication } from './document-update-client';
export { documentAfterOperation } from './document-update-history';
export { storyUpdateParts } from './update-parts';

// ---- Assets: asset URLs, external images and the lazy code a page loads.
export type { WebAssetBox } from './asset-url';
export { assetLookupFrom, assetUrlFor, canonicalAssetUrl, urlHash } from './asset-url';
export { collectExternalAssetUrls } from './external-images';
export type { LazyCode } from './lazy-code';
export { CHART_VIZ_KINDS, lazyCodeOf } from './lazy-code';

// ---- Head: the <Helmet> split and its checks, the title, PWA settings, social preview and CSP origins.
export type { HelmetContent } from './helmet';
export { dataflowOf, declarationsOf, declaresMutations, EMPTY_HELMET_CONTENT, splitHelmet, validateHelmet } from './helmet';
export { displayTitle, firstHeadingTitle } from './title';
export type { PwaSettings } from './pwa-settings';
export { readPwaSettings } from './pwa-settings';
export type { SocialPreviewCrop } from './social-preview';
export {
  clampImageCrop, parseSocialPreviewCrop, savedSocialPreviewImageCrop, SOCIAL_PREVIEW_OVERVIEW_GENERATION, socialPreviewCrop, socialPreviewImage,
} from './social-preview';
export type { CspDirective, CspExtensions, CspRequest } from './csp-extensions';
export {
  coversCspExtensions, CSP_DIRECTIVES, cspExtensionsOf, cspOriginMatches, EMPTY_CSP_EXTENSIONS, emptyCspExtensions, hasCspExtensions,
  mergeCspExtensions, parseCspOrigin, storedCspExtensions, subtractCspExtensions,
} from './csp-extensions';

// ---- Comments: where a comment points (range, anchors), how edits move it, and mentions in its text.
export type { AnnotationRange } from './annotation-range';
export { canonicalQuote, canonicalText, isAreaRange, isTargetRange, parseAnnotationRange, parseRel, refinementRange } from './annotation-range';
export type { AnchorEntry } from './anchors';
export { anchorIndex, anchorKeyOf, snippetOf, sourceWithoutAnchors } from './anchors';
export type { AnnotationReceipt, AnnotationRecord } from './annotation-edits';
export { annotationEffects, parseAnnotationOperations } from './annotation-edits';
export { isPersonMentionHref, personMentions } from './person-mentions';

// ---- Capabilities: what an author may write, for the capabilities route.
export { authoringCapabilities } from './authoring-capabilities';
