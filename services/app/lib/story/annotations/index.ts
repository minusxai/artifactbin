/** What server code outside lib/story imports from this sub-module. Browser-bundled code imports the leaf files directly: the island and app bundlers cannot drop the rest of a barrel. */
export { annotationEffects, parseAnnotationOperations } from './annotation-edits';
export type { AnnotationReceipt, AnnotationRecord } from './annotation-edits';
export { canonicalQuote, canonicalText, isAreaRange, isTargetRange, parseAnnotationRange, parseRel, refinementRange } from './annotation-range';
export type { AnnotationRange } from './annotation-range';
export type { CommentTarget } from './comment-target';
