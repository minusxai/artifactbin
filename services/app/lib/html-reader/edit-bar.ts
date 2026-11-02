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
