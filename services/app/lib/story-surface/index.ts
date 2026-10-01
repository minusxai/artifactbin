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
export { STORY_BARE_CONTROLS_CSS, BARE_CONTROL_EXCLUDED_TYPES } from './bare-controls';

/** Marks the story root element — the element a document's body renders into. */
export const STORY_ROOT_ATTR = 'data-mx-story-root';

/**
 * On the story root when any element of the document carries a `class` (the author styled it): the bare
 * typography's document padding is for wholly unstyled documents only. Stamped at serve time from the HTML the
 * root wraps (lib/compiled-page/story-element), so stored pages need no new field.
 */
export const STORY_STYLED_ATTR = 'data-mx-styled';
