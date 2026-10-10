/**
 * WHERE A COMMENT POINTS AND HOW EDITS MOVE IT, browser-safe: the stored annotation range (text,
 * target or area), its canonical quote, and the effects an edit's annotation operations have.
 * `AnnotationOperation` is defined here (as the wire's `DocumentAnnotationOperation`); lib/editor-engine
 * imports it downward. Browser-bundled code imports the leaf files directly.
 */
export { isAreaRange, parseAnnotationRange, refinementRange } from './annotation-range';
