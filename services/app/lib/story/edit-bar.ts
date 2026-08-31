/**
 * The contextual editing toolbar's height, RESERVED by the page rather than
 * measured. It is the only bar in the product now.
 *
 * Its own module because the page needs the number in view mode too — and
 * importing it from the editor would pull the editor (Monaco, the panels, the
 * whole chart inspector) into the graph of every reader who will never open it.
 */
export const EDIT_BAR_H = 48;

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
