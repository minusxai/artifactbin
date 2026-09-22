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
 * The RIGHT RAIL's width, reserved the same way: the page narrows the
 * document's viewport by exactly this while the rail is open, so the rail
 * never covers the document it is about (the Google-Docs squeeze).
 *
 * ONE number for both occupants. It was two — a 320px annotation sidebar and
 * the editor's own 288px embed inspector — and they never met only because
 * annotate and edit were mutually exclusive modes. Taking the mode away
 * introduces them, so they share a width and a reservation rather than
 * discovering each other at runtime.
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
 * The LEFT RAIL's width — the icon strip that names what the artifact is made
 * of (app, code, queries, history).
 *
 * It exists to give the two edges MEANINGS: left is the document's own
 * structure, right is annotation about it. That reverses the inspector rule
 * above for the left side only — a left panel RESERVES like the comments rail
 * rather than overlaying, because a panel that covers the document it edits is
 * the thing readers kept reporting. Comments keep the right edge to themselves,
 * so the two surfaces never negotiate for it.
 */
export const LEFT_RAIL_W = 232;

