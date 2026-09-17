/** Dashboard engagement data and the interaction contract handed to Vega. */
import { describe, expect, it } from 'vitest';
import { compileVegaLite } from '@/lib/viz/render-vega';
import { ENGAGEMENT_SPEC, engagementRows } from '@/components/Dashboard';

describe('dashboard engagement chart', () => {
  it('aligns trailing views and likes into long-form daily Vega rows', () => {
    const rows = engagementRows([3, 5, 8], [2], new Date('2026-09-05T10:00:00Z'));
    expect(rows).toEqual([
      { day: '2026-09-03T12:00:00Z', series: 'views', value: 3 },
      { day: '2026-09-03T12:00:00Z', series: 'likes', value: 0 },
      { day: '2026-09-04T12:00:00Z', series: 'views', value: 5 },
      { day: '2026-09-04T12:00:00Z', series: 'likes', value: 0 },
      { day: '2026-09-05T12:00:00Z', series: 'views', value: 8 },
      { day: '2026-09-05T12:00:00Z', series: 'likes', value: 2 },
    ]);
  });

  it('compiles a tooltip-enabled, series-clickable Vega-Lite spec', () => {
    const mark = ENGAGEMENT_SPEC.mark as Record<string, unknown>;
    const params = ENGAGEMENT_SPEC.params as Array<Record<string, unknown>>;
    const encoding = ENGAGEMENT_SPEC.encoding as Record<string, Record<string, unknown>>;
    expect(mark).toMatchObject({ type: 'area', fillOpacity: 0.14, line: { strokeWidth: 2 } });
    expect(encoding.y.stack).toBeNull();
    expect(params[0]).toMatchObject({
      bind: 'legend',
      select: { fields: ['series'], on: 'click', clear: 'dblclick' },
    });
    expect(encoding.tooltip).toHaveLength(3);
    expect(encoding.opacity).toMatchObject({ condition: { param: 'engagement_series' } });
    expect(() => compileVegaLite(ENGAGEMENT_SPEC, 'light')).not.toThrow();
  });
});
