/**
 * The embed family's root classes: none. `<Iframe>` carries the author's class on its box and `<DeckGL>` on the
 * map's own box, as given (the compiler's `className` fallback), exactly as the former runtime adapters do.
 */
import type { Recipe } from '.';

export const RECIPES: Record<string, Recipe> = {};
