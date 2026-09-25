/**
 * The contextual editing toolbar's height, RESERVED by the page rather than
 * measured. Document actions (44), formatting and selection context (36),
 * then an 8px gap before the document.
 *
 * Its own module because the page needs the number in view mode too — and
 * importing it from the editor would pull the editor (Monaco, the panels, the
 * whole chart inspector) into the graph of every reader who will never open it.
 */
export const EDIT_BAR_H = 88;

/**
 * Just the document-actions row. The formatting row below it belongs to the
 * APP view — there is nothing on a page to select while you are reading SQL or
 * source — so those views draw the bar one row tall and start this much lower.
 */
export const EDIT_BAR_ROW_H = 44;

/** The page's own bar, drawn above the editor bar in edit mode (components/PageChrome AppBar). */
export const APP_BAR_H = 44;

/**
 * The RIGHT RAIL's width. Reading, the comments rail: the page narrows the
 * document's viewport by exactly this while it is open, so it never covers the
 * document it is about (the Google-Docs squeeze). Editing, the edit panel
 * (components/EditPanel), whose Selection, History and Comments tabs share it:
 * decided once on entry — out of the document's empty margin when it fits,
 * reserved when it does not — and unchanged by anything inside the session.
 */
export const RIGHT_RAIL_W = 320;

/**
 * The QUERY NOTEBOOK's width. Wider than the rail it borrows, because SQL and
 * result tables are column-shaped where the inspectors are form-shaped. It
 * OVERLAYS rather than reserves (the inspector rule: the page does not narrow
 * the document for it), so it shares the rail's edge and layer, not its number.
 */
export const QUERY_RAIL_W = 480;

/**
 * THE EDIT PANEL — one right panel for the whole edit session (components/
 * EditPanel): Selection, History and Comments as tabs of RIGHT_RAIL_W, or a
 * strip of their icons this wide when the viewer collapsed it.
 */
export const EDIT_PANEL_STRIP_W = 44;

/**
 * The narrowest document the panel may sit beside. Below
 * RIGHT_RAIL_W + this (960px) there is no side panel at all: the document keeps
 * the full width and the panel's tabs open as bottom sheets instead.
 */
export const EDIT_PANEL_MIN_DOC_W = 640;
export const EDIT_PANEL_BREAKPOINT = RIGHT_RAIL_W + EDIT_PANEL_MIN_DOC_W;

/** By innerWidth, like isPhoneViewport: readable anywhere, settable by a test. */
export const isWideEditViewport = (width = typeof window === 'undefined' ? 0 : window.innerWidth) =>
  width >= EDIT_PANEL_BREAKPOINT;
