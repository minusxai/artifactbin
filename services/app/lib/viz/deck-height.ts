/** The `<DeckGL>` box's default height, and its height in px for an authored `height` — shared by every view and stand-in that must hold the same space. */
const DEFAULT_HEIGHT = 420;

export const deckGlHeight = (height: unknown): number =>
  typeof height === 'number' ? height : Number.parseInt(String(height ?? DEFAULT_HEIGHT), 10) || DEFAULT_HEIGHT;
