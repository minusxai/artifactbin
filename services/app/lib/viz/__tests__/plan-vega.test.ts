/** planVega is the one chart plan both the server drawing and the island controller use. */
import { describe, expect, it } from 'vitest';
import { computeLegendPlan, computeXLabelAngle, legendPlanKey, planVega, toVegaSpec } from '../render-vega';

const spec = {
  mark: 'bar',
  encoding: { x: { field: 'k', type: 'nominal' }, y: { field: 'v', type: 'quantitative' }, color: { field: 's', type: 'nominal' } },
};
const rows = Array.from({ length: 12 }, (_, i) => ({ k: `category number ${i}`, v: i, s: `series ${i % 6}` }));
const resolved = { spec, engine: 'vega-lite' as const };

describe('planVega', () => {
  it('composes the same plans and compile the two tiers used to repeat', () => {
    const size = { width: 300, height: 200 };
    const plan = planVega(resolved, rows, size, 'light', null);
    const legendPlan = computeLegendPlan(spec, rows, size.width);
    const xLabelAngle = computeXLabelAngle(spec, rows, size.width);
    const direct = toVegaSpec(resolved, 'light', { legendPlan, xLabelAngle, facetLayout: null, categoryRange: null });
    expect(plan.vl).toBe(spec);
    expect(plan.facetLayout).toBeNull();
    expect(JSON.stringify(plan.vegaSpec)).toBe(JSON.stringify(direct.vegaSpec));
    expect(plan.legendKey).toBe(legendPlanKey(spec, rows, size.width));
  });

  it('keys the rebuild decision on width and skips plans for native Vega', () => {
    expect(planVega(resolved, rows, { width: 300, height: 200 }, 'light', null).legendKey)
      .not.toBe(planVega(resolved, rows, { width: 1400, height: 200 }, 'light', null).legendKey);
    expect(legendPlanKey(null, rows, 300)).toBe(JSON.stringify({ legend: null, xAngle: null }));
  });
});
