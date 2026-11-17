/**
 * A checked chart description (lib/html-component-specs/chart-spec) → the renderable spec and its
 * grammar. Recipes materialize from the shipped registry (viz-templates) with column kinds inferred
 * from the rows. Engine-free; <af-chart> loads this lazily, only for a recipe.
 */
import { inferColumns, type ChartDescription } from '@/lib/html-component-specs/chart-spec';
import type { ResolvedChartSpec } from './chart-plan';
import { materializeRecipe } from './viz-templates';

export function resolveChartDescription(
  description: ChartDescription,
  rows: readonly Record<string, unknown>[],
): { ok: true; resolved: ResolvedChartSpec } | { ok: false; error: string } {
  if (description.kind !== 'recipe') return { ok: true, resolved: { spec: description.spec, engine: description.kind } };
  const result = materializeRecipe({ recipe: description.recipe, bindings: description.bindings,
    params: description.params ?? null }, inferColumns(rows));
  return result.ok ? { ok: true, resolved: { spec: result.spec, engine: result.engine } } : { ok: false, error: result.error };
}
