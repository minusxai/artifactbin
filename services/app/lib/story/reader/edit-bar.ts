/** A single document-actions row. Appearance and formatting live in the Selection panel. */
export const EDIT_BAR_H = 44;

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
const EDIT_PANEL_MIN_DOC_W = 640;
export const EDIT_PANEL_BREAKPOINT = RIGHT_RAIL_W + EDIT_PANEL_MIN_DOC_W;

/** By innerWidth, like isPhoneViewport: readable anywhere, settable by a test. */
export const isWideEditViewport = (width = typeof window === 'undefined' ? 0 : window.innerWidth) =>
  width >= EDIT_PANEL_BREAKPOINT;
