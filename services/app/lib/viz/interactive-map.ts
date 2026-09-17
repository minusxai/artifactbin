/**
 * Which charts respond to wheel, drag and hover — the one definition.
 *
 * Two callers need the answer and it must be the SAME answer: `VegaChart` (to wire
 * up view-state persistence) and the dashboard tile (to decide whether its edit-mode
 * drag surface may cover the chart). A tile that judges an interactive map static
 * keeps the full-card overlay, which eats every event — and nothing about the chart
 * looks wrong, so the disagreement is invisible.
 *
 * Detection is by CAPABILITY (the `mxViewParams` signal) rather than recipe id, so a
 * DETACHED map (kind: 'vega', no recipe) stays interactive. Recipe ids are a fast path.
 */
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const POINT_MAP_RECIPE = 'minusx/point-map@1';
const CHOROPLETH_RECIPE = 'minusx/choropleth@1';

const recipeOf = (env: VizEnvelope): string | undefined =>
  (env.source as unknown as { recipe?: string })?.recipe;

/**
 * Does a raw (detached) native-Vega spec declare this signal? Lets map capabilities
 * survive detach, when the recipe id is gone but the signals remain in the spec.
 */
const specHasSignal = (env: VizEnvelope, name: string): boolean => {
  const src = env.source as unknown as { kind?: string; spec?: { signals?: Array<{ name?: string }> } };
  return src?.kind === 'vega' && Array.isArray(src.spec?.signals) && src.spec.signals.some(s => s?.name === name);
};

/** An envelope that pans/zooms (point_map / choropleth / a detached map spec). */
export const isInteractiveMapEnvelope = (env: VizEnvelope): boolean =>
  recipeOf(env) === POINT_MAP_RECIPE
  || recipeOf(env) === CHOROPLETH_RECIPE
  || specHasSignal(env, 'mxViewParams');
