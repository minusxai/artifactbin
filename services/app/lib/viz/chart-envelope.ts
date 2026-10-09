/** The one conversion from a Question viz prop to a chart envelope. */
import type { TableResult } from '@/lib/dataflow/dataflow';
import type { RefDataMap } from '@/lib/dataflow/ref-data';
import { columnVizKind } from '@/lib/dataflow/dataset-shape';
import { materializeFileRecipe } from '@/lib/viz/recipe-file';
import type { VizResultColumn } from '@/lib/viz/types';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const envelope = (source: VizEnvelope['source']): VizEnvelope => ({
  version: 2, source, dataBindings: null, viewParams: null, interactions: null, assets: null,
});

export function questionEnvelope(viz: Record<string, unknown>, columns: TableResult['columns'], refData?: RefDataMap): VizEnvelope | { error: string } {
  const kind = viz.kind;
  const spec = viz.spec && typeof viz.spec === 'object' && !Array.isArray(viz.spec) ? viz.spec as Record<string, unknown> : {};
  if (kind === 'vega-lite') return envelope({ kind, grammar: 'vega-lite@6', spec });
  if (kind === 'vega') return envelope({ kind, grammar: 'vega@6', spec });
  if (kind === 'recipe' && typeof viz.recipe === 'string' && !viz.recipe.startsWith('ref:')) return envelope({
    kind, recipe: viz.recipe,
    bindings: (viz.bindings ?? {}) as Record<string, string | string[]>,
    params: (viz.params ?? null) as Record<string, unknown> | null,
    columnFormats: (viz.columnFormats ?? null) as Extract<VizEnvelope['source'], { kind: 'recipe' }>['columnFormats'],
  });
  if (kind === 'recipe' && typeof viz.recipe === 'string') {
    const resolved = refData?.[viz.recipe.slice(4)];
    if (resolved?.kind !== 'viz') return { error: 'recipe unavailable — falling back' };
    const cols: VizResultColumn[] = columns.map(column => ({ name: column.name, kind: columnVizKind(column.type) }));
    const result = materializeFileRecipe(resolved.recipe, (viz.bindings ?? {}) as Record<string, string | string[]>, (viz.params ?? null) as Record<string, unknown> | null, cols);
    if (!result.ok) return { error: `recipe error: ${result.error}` };
    return result.engine === 'vega-lite'
      ? envelope({ kind: 'vega-lite', grammar: 'vega-lite@6', spec: result.spec })
      : envelope({ kind: 'vega', grammar: 'vega@6', spec: result.spec });
  }
  return { error: `unknown viz kind "${String(kind)}"` };
}
