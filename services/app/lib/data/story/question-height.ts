// The <Question> sizing contract — ONE for every renderer.
//
// The editor canvas (StoryJsxBody) and the served view document (StoryRuntimeApp)
// render the same stored source through different adapters; before this contract
// was shared they each carried their own defaults (430 vs 320), so a chart
// without an authored height changed size between editing and reading. The
// skill documents "Missing height defaults to 430px" — this is that number.
//
// It lives in its OWN leaf module, importing nothing, because the served
// document's runtime needs exactly this and nothing else from the <Question>
// editing modules. Those import the editor's AST write-back (jsx-edit →
// lib/jsx → acorn), so a runtime asking for one number downloaded a 250 KB JSX
// parser it can never use — the island carries parsed NODES, not source.
// Guarded by lib/__tests__/reader-bundle-hygiene.test.ts; keep this file
// dependency-free.
// ---------------------------------------------------------------------------

export const MIN_CHART_H = 340;
export const DEFAULT_CHART_H = 430;
export const SINGLE_VALUE_MIN_H = 48;
export const SINGLE_VALUE_DEFAULT_H = 120;

/**
 * `height` attr ("300px" | "300" | 300 | absent/garbage) → the embed's px height:
 * parsed values clamp to the tier floor; anything unparseable takes the default.
 * `bare` is the chrome-less single_value tier (its own floor/default).
 */
export function questionEmbedHeightPx(height: unknown, bare: boolean): number {
  const n = typeof height === 'number' ? height : typeof height === 'string' ? parseFloat(height) : NaN;
  if (!Number.isFinite(n)) return bare ? SINGLE_VALUE_DEFAULT_H : DEFAULT_CHART_H;
  return Math.max(n, bare ? SINGLE_VALUE_MIN_H : MIN_CHART_H);
}
