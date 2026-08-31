/**
 * The og-card stage, alone in a module so pages can size their og:image tags
 * without importing lib/export — whose static playwright import belongs only
 * in the export route's graph, never a reader page's.
 *
 * 1600×840, not 1200×630: same 40:21 og ratio, but desktop-width — vh-based
 * heroes designed for a real browser window collapse into gaps and over-eager
 * wrapping on a 1200px stage.
 */
export const CARD_WIDTH = 1600;
export const CARD_HEIGHT = 840;
