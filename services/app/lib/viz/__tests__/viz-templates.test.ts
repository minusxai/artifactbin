/**
 * Shipped recipes (`recipe` source kind): the saved content is ONLY the
 * reference {kind, recipe, bindings}; the spec materializes at render from the
 * code registry. These tests cover materialization, validation of the reference
 * (including bindings → real columns), and headless rendering.
 */
import { describe, it, expect } from 'vitest';
import { materializeRecipe, getTemplate, VIZ_TEMPLATES } from '@/lib/viz/viz-templates';
import { renderVegaLiteToSvg } from '@/lib/viz/render-vega';
import type { VizResultColumn } from '@/lib/viz/types';

const COLUMNS: VizResultColumn[] = [
  { name: 'stage', kind: 'nominal' },
  { name: 'users', kind: 'quantitative' },
];

const recipeEnvelope = (recipe: string, bindings: Record<string, string>) => ({
  version: 2,
  source: { kind: 'recipe', recipe, bindings },
});

const FUNNEL_ROWS = [
  { stage: 'Visited', users: 1000 },
  { stage: 'Signed up', users: 400 },
  { stage: 'Activated', users: 180 },
  { stage: 'Paid', users: 60 },
];

const WATERFALL_ROWS = [
  { stage: 'Start', users: 500 },
  { stage: 'New', users: 300 },
  { stage: 'Churn', users: -200 },
  { stage: 'Expansion', users: 120 },
];

describe('registry', () => {
  it('ships funnel@1 and waterfall@1 with typed bindings', () => {
    expect(Object.keys(VIZ_TEMPLATES)).toEqual(['minusx/funnel@1', 'minusx/waterfall@1', 'minusx/radar@1', 'minusx/trend@1', 'minusx/single-value@1', 'minusx/combo@1', 'minusx/choropleth@1', 'minusx/point-map@1']);
    expect(getTemplate('minusx/funnel@1')!.bindings.map(b => b.name)).toEqual(['stage', 'value']);
  });
});

describe('materializeRecipe', () => {
  it('materializes a funnel spec from the reference', () => {
    const result = materializeRecipe({ recipe: 'minusx/funnel@1', bindings: { stage: 'stage', value: 'users' } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Array.isArray(result.spec.layer)).toBe(true);
  });

  it('reports unknown recipe ids with the available list', () => {
    const result = materializeRecipe({ recipe: 'minusx/sankey@1', bindings: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('minusx/funnel@1');
  });

  it('reports missing bindings by name', () => {
    const result = materializeRecipe({ recipe: 'minusx/waterfall@1', bindings: { category: 'stage' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('value');
  });
});

describe('minusx/trend@1 color params', () => {
  const trend = (params: Record<string, unknown> | null) =>
    materializeRecipe({ recipe: 'minusx/trend@1', bindings: { date: 'week', value: ['revenue', 'orders'] }, params });

  it('defaults to the themed category range (colors follow --chart tokens)', () => {
    const result = trend(null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.stringify(result.spec)).toContain('"range":"category"');
  });

  it('trendColor pins every series (one entry per bound measure), and everything derived follows', () => {
    const result = trend({ trendColor: '#ff0066' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = JSON.stringify(result.spec);
    // The fixed range replaces the themed one — sparkline, gradients and the
    // value's default fill all read scale('color', …), so one pin covers them.
    expect(text).toContain('"range":["#ff0066","#ff0066"]');
    expect(text).not.toContain('"range":"category"');
  });

  it('valueColor overrides the big numeral alone, leaving the series scale themed', () => {
    const result = trend({ valueColor: '#112233' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = JSON.stringify(result.spec);
    expect(text).toContain('"fill":{"value":"#112233"}');
    expect(text).toContain('"range":"category"');
  });

  it('ignores non-string junk rather than emitting a broken scale', () => {
    const result = trend({ trendColor: 42, valueColor: { hex: '#000' } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.stringify(result.spec)).toContain('"range":"category"');
  });
});

describe('recipe tooltips — no internal __mx field leaks', () => {
  const layersOf = (recipe: string, bindings: Record<string, string>) => {
    const m = materializeRecipe({ recipe, bindings });
    if (!m.ok) throw new Error(m.error);
    return (m.spec as { layer: Array<Record<string, any>> }).layer;
  };

  it('funnel: the area shows Stage + Value; text labels have tooltips OFF', () => {
    const layers = layersOf('minusx/funnel@1', { stage: 'stage', value: 'users' });
    const area = layers.find(l => l.mark?.type === 'area')!;
    const fields = (area.encoding.tooltip as Array<{ field: string }>).map(t => t.field);
    expect(fields).toContain('stage');
    expect(fields).toContain('__mx_value');
    expect(fields).not.toContain('__mx_x0'); // the internal geometry field never surfaces
    for (const l of layers.filter(l => l.mark?.type === 'text')) expect(l.mark.tooltip).toBe(false);
  });

  it('waterfall: the bars show Step + Value; text labels have tooltips OFF', () => {
    const layers = layersOf('minusx/waterfall@1', { category: 'step', value: 'delta' });
    const bar = layers.find(l => l.mark?.type === 'bar')!;
    const fields = (bar.encoding.tooltip as Array<{ field: string }>).map(t => t.field);
    expect(fields).toContain('step');
    expect(fields).not.toContain('__mx_prev'); // no running-total internals leak
    for (const l of layers.filter(l => l.mark?.type === 'text')) expect(l.mark.tooltip).toBe(false);
  });
});

describe('headless rendering of materialized recipes', () => {
  it('funnel renders a tapered area with stage labels and first-stage percentages', async () => {
    const m = materializeRecipe({ recipe: 'minusx/funnel@1', bindings: { stage: 'stage', value: 'users' } });
    if (!m.ok) throw new Error(m.error);
    const svg = await renderVegaLiteToSvg(m.spec, FUNNEL_ROWS, 'dark', { width: 480, height: 300 });
    expect(svg).toContain('mark-area');
    expect(svg).toContain('Visited');
    expect(svg).toContain('Paid');
    expect(svg).toContain('(100.0%)'); // first stage is the baseline
    expect(svg).toContain('(6.0%)');   // 60 / 1000
  });

  it('funnel draws per-stage ZEBRA bands: one area per stage, alternating opacity', () => {
    const m = materializeRecipe({ recipe: 'minusx/funnel@1', bindings: { stage: 'stage', value: 'users' } });
    if (!m.ok) throw new Error(m.error);
    const layers = (m.spec as { layer: Array<Record<string, any>> }).layer;
    const area = layers.find(l => l.mark?.type === 'area')!;
    // One band per stage (not one continuous silhouette): the stage rank splits the area.
    expect(area.encoding.detail?.field).toBe('__mx_rank');
    // Zebra: fillOpacity alternates on rank parity — two DIFFERENT opacities.
    const fo = area.encoding.fillOpacity;
    expect(fo.condition.test).toContain('__mx_rank % 2');
    expect(fo.condition.value).not.toBe(fo.value);
  });

  it('funnel orientation param flips the taper axis (horizontal → stages run left to right)', () => {
    const horizontal = materializeRecipe({
      recipe: 'minusx/funnel@1', bindings: { stage: 'stage', value: 'users' },
      params: { orientation: 'horizontal' },
    });
    if (!horizontal.ok) throw new Error(horizontal.error);
    const area = (horizontal.spec as { layer: Array<Record<string, any>> }).layer.find(l => l.mark?.type === 'area')!;
    // Horizontal: the stage sequence runs along x; the taper (ranged span) along y.
    expect(area.encoding.x.field).toBe('__mx_pos');
    expect(area.encoding.y.field).toBe('__mx_x0');
    expect(area.encoding.y2.field).toBe('__mx_x1');

    const vertical = materializeRecipe({ recipe: 'minusx/funnel@1', bindings: { stage: 'stage', value: 'users' } });
    if (!vertical.ok) throw new Error(vertical.error);
    const vArea = (vertical.spec as { layer: Array<Record<string, any>> }).layer.find(l => l.mark?.type === 'area')!;
    expect(vArea.encoding.y.field).toBe('__mx_pos'); // default stays top-to-bottom
    expect(vArea.encoding.x.field).toBe('__mx_x0');
    expect(vArea.encoding.x2.field).toBe('__mx_x1');
  });

  it('horizontal funnel renders headlessly with stage labels', async () => {
    const m = materializeRecipe({
      recipe: 'minusx/funnel@1', bindings: { stage: 'stage', value: 'users' },
      params: { orientation: 'horizontal' },
    });
    if (!m.ok) throw new Error(m.error);
    const svg = await renderVegaLiteToSvg(m.spec, FUNNEL_ROWS, 'dark', { width: 480, height: 300 });
    expect(svg).toContain('mark-area');
    expect(svg).toContain('Visited');
    expect(svg).toContain('(6.0%)');
  });

  it('waterfall renders floating bars in data order with signed labels', async () => {
    const m = materializeRecipe({ recipe: 'minusx/waterfall@1', bindings: { category: 'stage', value: 'users' } });
    if (!m.ok) throw new Error(m.error);
    const svg = await renderVegaLiteToSvg(m.spec, WATERFALL_ROWS, 'dark', { width: 480, height: 300 });
    expect(svg).toContain('mark-rect');
    expect(svg).toContain('Churn');
    expect(svg).toContain('+300');
    expect(svg).toContain('−200'); // d3 format uses minus sign U+2212
    expect(svg).toContain('Total'); // closing total bar
    expect(svg).toContain('720');   // 500 + 300 - 200 + 120
    expect(svg).toMatch(/role-axis-title[\s\S]{0,600}?>users</); // VISIBLE y-axis title, not an aria string
  });
});
