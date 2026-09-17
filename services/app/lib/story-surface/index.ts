/**
 * The story SURFACE: the story-domain facts about the element a document's
 * body renders into.
 *
 * This module used to own a sizing CONTRACT — mount the body inside
 * `<svg><foreignObject>` in a same-origin iframe, measure its content, push the
 * measured height back into the svg every sync — because the owner's editing
 * canvas was a live rendering the app itself had to size, and the same live
 * svg could then be rasterized for slide thumbnails without re-deriving pixels.
 *
 * There is no such rendering any more. A document is SERVED (`/a/<id>/raw`) and
 * sizes itself against its own viewport, and editing is a mode that document
 * enters in place — so nothing outside a document measures a document. What is
 * left is the name of the root element, which the served document stamps and
 * the page's CSS and the exporter both look for.
 */
export { remapViewportHeightUnits, STORY_VH_VAR, STORY_VH_FALLBACK } from './viewport-units';
export { STORY_BARE_TYPOGRAPHY_CSS, BARE_TYPOGRAPHY_ELEMENTS } from './bare-typography';

/** Marks the story root element — the element a document's body renders into. */
export const STORY_ROOT_ATTR = 'data-mx-story-root';
