/** The page's own bar, drawn above the editor bar in edit mode. */
export const APP_BAR_H = 44;

/**
 * The RIGHT RAIL's width. Reading, the comments rail: the page narrows the
 * document's viewport by exactly this while it is open, so it never covers the
 * document it is about (the Google-Docs squeeze). Editing, the edit panel,
 * whose Selection, History and Comments tabs share it:
 * decided once on entry — out of the document's empty margin when it fits,
 * reserved when it does not — and unchanged by anything inside the session.
 */
export const RIGHT_RAIL_W = 320;

/**
 * The region editing toolbar's strip under the app bar (solid/document/RegionToolbar), drawn over the frame's top
 * edge while a person edits a region: the document reserves it (the bridge's `inset`) instead of moving.
 */
export const REGION_TOOLBAR_H = 44;
