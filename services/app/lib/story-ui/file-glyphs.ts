/**
 * WHICH GLYPH A FILE DRAWS — one map, shared by the two halves that must agree.
 *
 * `<Files>` (components/kit/files) picks a row's icon from its FORMAT, and the
 * SERVER resolves the glyphs a document needs before the document is served
 * (lib/story/icon-glyphs): the icon set never reaches the reader's bundle, so a
 * glyph nobody resolved draws NOTHING. A folder's whole document is
 * `<Files data="$children" />` and names no `<Icon>` at all, so the scan has to
 * learn this list — and it has to be the SAME list the component then asks for,
 * or the listing silently draws holes.
 *
 * Pure and import-free: it is read by the document kit, which may not reach
 * into app chrome or into the icon package.
 */

/** Every artifact format, and the lucide glyph that stands for it. */
export const FILE_FORMAT_GLYPHS: Record<string, string> = {
  folder: 'folder',
  markup: 'file-text',
  dataset: 'table',
  image: 'image',
  pdf: 'file',
  viz: 'chart-bar',
};

/** The distinct glyphs a `<Files>` listing can draw — what the server resolves for it. */
export const FILE_GLYPH_NAMES: string[] = [...new Set(Object.values(FILE_FORMAT_GLYPHS))];

/**
 * The glyph for a format. An unrecognised one draws the generic file rather
 * than nothing: a row is a real artifact whatever its format is called, and a
 * hole in the listing would read as a broken document.
 */
export const fileGlyphName = (format: unknown): string =>
  FILE_FORMAT_GLYPHS[String(format ?? '')] ?? FILE_FORMAT_GLYPHS.pdf;
