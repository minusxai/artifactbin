import { describe, expect, it } from 'vitest';
import { checkDocumentData, vegaLiteStructureError } from '../data-checks';
import { queryRows } from '@/lib/datasets/query-rows';
import type { DatasetColumn } from '../dataset-shape';
import type { RefLoader } from '../refs';

const DS = 'abc123';
const columns: DatasetColumn[] = [
  { name: 'team', type: 'string' },
  { name: 'channel', type: 'string' },
  { name: 'median_resolution_hours', type: 'number' },
];
const load: RefLoader = async (id) => (id === DS ? { id: DS, format: 'dataset', columns, query: (sql, params) => queryRows({ columns, rows: [] }, sql, params) } : null);
const doc = (viz: string) =>
  '<Helmet>' +
  `<Query name="june" source="ref:${DS}">{\`select team, channel, median_resolution_hours from public.rows\`}</Query>` +
  '</Helmet>' +
  `<Question data="$june" viz={${viz}} height="300px" />`;

// The spec pi published in eval run 34703431814: a top-level facet beside mark/encoding.
const FACET_BESIDE_MARK = '{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"team","type":"nominal"},"y":{"field":"median_resolution_hours","type":"quantitative"}},"facet":{"column":{"field":"channel","type":"nominal"}}}}';
const FACET_AS_ENCODING = '{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"team","type":"nominal"},"y":{"field":"median_resolution_hours","type":"quantitative"},"column":{"field":"channel","type":"nominal"}}}}';

describe('the publish door refuses a Vega-Lite spec the renderer cannot read', () => {
  it('names the query and carries the normaliser\'s message — this spec published and crashed a dashboard tile', async () => {
    const r = await checkDocumentData(doc(FACET_BESIDE_MARK), load);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('invalid_refs');
      expect(r.details.join('\n')).toMatch(/query \$june: viz is not a Vega-Lite spec the renderer can read — .*transform/);
    }
  });

  it('the same chart with the facet inside encoding passes', async () => {
    const r = await checkDocumentData(doc(FACET_AS_ENCODING), load);
    expect(r.ok).toBe(true);
  });

  it('the helper leaves the spec it checks untouched', () => {
    const spec = { mark: 'line', encoding: { x: { field: 'team', type: 'nominal' }, y: { field: 'median_resolution_hours', type: 'quantitative' } } };
    const before = JSON.stringify(spec);
    expect(vegaLiteStructureError(spec)).toBeNull();
    expect(JSON.stringify(spec)).toBe(before);
  });
});
