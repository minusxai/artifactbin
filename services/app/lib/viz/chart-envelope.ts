/** The one conversion from a Question viz prop to a chart envelope. */
import type { TableResult } from '@/lib/story/dataflow';
import type { RefDataMap } from '@/lib/story/ref-data';
import { columnVizKind } from '@/lib/story/dataset-shape';
import { materializeFileRecipe } from '@/lib/viz/recipe-file';
import type { VizResultColumn } from '@/lib/viz/types';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

export function questionEnvelope(viz: Record<string, unknown>, columns: TableResult['columns'], refData?: RefDataMap): VizEnvelope | { error: string } {
  const kind = viz.kind;
  if (kind === 'vega-lite' || kind === 'vega') return { version: 2, source: { kind, grammar: kind === 'vega-lite' ? 'vega-lite@6' : 'vega@6', spec: viz.spec ?? {} } } as unknown as VizEnvelope;
  if (kind === 'recipe' && typeof viz.recipe === 'string' && !viz.recipe.startsWith('ref:')) return { version: 2, source: { kind: 'recipe', recipe: viz.recipe, bindings: viz.bindings ?? {}, params: viz.params ?? null, columnFormats: viz.columnFormats ?? null } } as unknown as VizEnvelope;
  if (kind === 'recipe' && typeof viz.recipe === 'string') {
    const resolved = refData?.[viz.recipe.slice(4)];
    if (resolved?.kind !== 'viz') return { error: 'recipe unavailable — falling back' };
    const cols: VizResultColumn[] = columns.map(column => ({ name: column.name, kind: columnVizKind(column.type) }));
    const result = materializeFileRecipe(resolved.recipe, (viz.bindings ?? {}) as Record<string, string | string[]>, (viz.params ?? null) as Record<string, unknown> | null, cols);
    if (!result.ok) return { error: `recipe error: ${result.error}` };
    return { version: 2, source: { kind: result.engine, grammar: result.engine === 'vega-lite' ? 'vega-lite@6' : 'vega@6', spec: result.spec } } as unknown as VizEnvelope;
  }
  return { error: `unknown viz kind "${String(kind)}"` };
}
