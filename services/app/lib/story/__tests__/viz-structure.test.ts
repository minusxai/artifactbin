import { describe, expect, it } from 'vitest';
import { validateVizAgainstColumns } from '../refs';

const columns = [
  { name: 'team', type: 'string' as const },
  { name: 'channel', type: 'string' as const },
  { name: 'median_resolution_hours', type: 'number' as const },
];

describe('validateVizAgainstColumns refuses a spec the renderer cannot read', () => {
  it('a top-level facet beside mark/encoding — published and crashed a dashboard tile in eval run 34703431814', () => {
    const viz = {
      kind: 'vega-lite',
      spec: {
        mark: 'bar',
        encoding: { x: { field: 'team', type: 'nominal' }, y: { field: 'median_resolution_hours', type: 'quantitative' } },
        facet: { column: { field: 'channel', type: 'nominal' } },
      },
    };
    const out = validateVizAgainstColumns(viz, columns, 'query $june');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/query \$june: viz is not a Vega-Lite spec the renderer can read — .*transform/);
  });

  it('the same chart written the way Vega-Lite wants it passes', () => {
    const viz = {
      kind: 'vega-lite',
      spec: {
        mark: 'bar',
        encoding: {
          x: { field: 'team', type: 'nominal' }, y: { field: 'median_resolution_hours', type: 'quantitative' },
          column: { field: 'channel', type: 'nominal' },
        },
      },
    };
    expect(validateVizAgainstColumns(viz, columns, 'query $june')).toEqual([]);
  });

  it('does not mutate the spec it checks', () => {
    const spec = { mark: 'line', encoding: { x: { field: 'team', type: 'nominal' }, y: { field: 'median_resolution_hours', type: 'quantitative' } } };
    const before = JSON.stringify(spec);
    validateVizAgainstColumns({ kind: 'vega-lite', spec }, columns, 'q');
    expect(JSON.stringify(spec)).toBe(before);
  });
});
