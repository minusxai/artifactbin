/**
 * WHERE A COMMENT POINTS AND HOW EDITS MOVE IT, browser-safe: the stored annotation range (text,
 * target or area), its canonical quote, and the effects an edit's annotation operations have.
 * `AnnotationOperation` is defined here (as the wire's `DocumentAnnotationOperation`); lib/editor-v2
 * imports it downward. Browser-bundled code imports the leaf files directly.
 */
export type { AnnotationRange } from './annotation-range';
export { areaTarget, boxFromRects, canonicalQuote, canonicalText, findNearest, formatRel, isAreaRange, isTargetRange, parseAnnotationRange, parseRel, rectFromBox, refinementRange } from './annotation-range';
export type { AnnotationOperation, AnnotationReceipt } from './annotation-edits';
export { annotationEffects, parseAnnotationOperations } from './annotation-edits';
