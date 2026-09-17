/**
 * The story SURFACE: the story-domain facts about the element a document's
 * body renders into.
 *
 * A document is SERVED (`/a/<id>/raw`) and sizes itself against its own
 * viewport, and editing is a mode that document enters in place — nothing
 * outside a document measures a document. So what this module holds is the
 * name of the root element, which the served document stamps and the page's
 * CSS and the exporter both look for.
 */
export { remapViewportHeightUnits, STORY_VH_VAR, STORY_VH_FALLBACK } from './viewport-units';
export { STORY_BARE_TYPOGRAPHY_CSS, BARE_TYPOGRAPHY_ELEMENTS } from './bare-typography';

/** Marks the story root element — the element a document's body renders into. */
export const STORY_ROOT_ATTR = 'data-mx-story-root';
