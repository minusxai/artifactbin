/**
 * HOW A PERSON IS DRAWN — the rules, once.
 *
 * A face is drawn by three renderers that cannot share a component: the app's
 * React chrome (`components/Avatar`), the document kit (`components/kit/
 * user-image`, rendered on the server and hydrated inside a document) and the
 * reader rail (`lib/story/reader-chrome`, an HTML string). They share THIS
 * module instead, so the same person is the same colour, the same letter and
 * the same fallback wherever they appear.
 *
 * The contract every renderer keeps:
 *  - a picture is painted OVER the initial, so an address that stops answering
 *    reveals the initial and never a broken-image glyph;
 *  - no picture → the initial on `personFaceBackground(id)`, white text;
 *  - an id we cannot name → a neutral `?`, never the raw id.
 *
 * Pure and React-free: the reader rail and the server import it.
 */

/**
 * A hue in 0..359 from the id — a pure function, on purpose: the colour is
 * computed on the server and again during hydration, and a random or
 * render-ordered hue would be a hydration mismatch on every page with a face.
 */
export function personHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  return hash;
}

/**
 * Saturation and lightness behind the initial. 55%/30% is the lightest pair at
 * which WHITE text clears WCAG AA (4.5:1) on EVERY hue — yellow (60°) is the
 * worst case, at 4.72:1. The test pins that, so a lighter value cannot land.
 */
export const PERSON_FACE_SATURATION = 55;
export const PERSON_FACE_LIGHTNESS = 30;

/** The CSS colour behind a person's initial. */
export const personFaceBackground = (id: string): string =>
  `hsl(${personHue(id)} ${PERSON_FACE_SATURATION}% ${PERSON_FACE_LIGHTNESS}%)`;

/** The letter drawn for a name (a handle, a display name or an email): its first, upper-cased, else `?`. */
export const personInitial = (name: string | null | undefined): string =>
  (name?.trim()[0] ?? '?').toUpperCase();
