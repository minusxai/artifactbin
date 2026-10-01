/** What server code outside lib/story imports from this sub-module. Browser-bundled code imports the leaf files directly: the island and app bundlers cannot drop the rest of a barrel. */
export { isAreaRange, parseAnnotationRange, refinementRange } from './annotation-range';
export type { CommentTarget } from './comment-target';
