import { describe, expect, it } from 'vitest';
import { checkDocumentData } from '../data/data-checks';
import type { DatasetColumn } from '@/lib/dataflow';
import type { RefLoader } from '@/lib/dataflow/server';

const DS = 'cel123';
const columns: DatasetColumn[] = [
  { name: 'name', type: 'string' },
  { name: 'revenue', type: 'number' },
  { name: 'day', type: 'date' },
];
const load: RefLoader = async (id) => (id === DS ? { id: DS, format: 'dataset', columns } : null);
const doc = (cell: string) =>
  '<Helmet>' +
  `<Import name="sales" src="ref:${DS}" /><Query name="q">{\`select name, revenue, day from sales.rows\`}</Query>` +
  '</Helmet>' +
  `<p>${cell}</p>`;

describe('a <Cell> is checked against its query\'s columns at publish', () => {
  it('accepts one value of a text column and every aggregate of a numeric one', async () => {
    for (const cell of [
      '<Cell data="$q" col="name" />', '<Cell data="$q" col="name" agg="last" />', '<Cell data="$q" col="name" agg="count" />',
      '<Cell data="$q" col="day" />', '<Cell data="$q" col="revenue" agg="sum" format="$,.0f" />', '<Cell data="$q" col="revenue" agg="median" />',
    ]) expect(await checkDocumentData(doc(cell), load), cell).toMatchObject({ ok: true });
  });

  it('refuses a numeric aggregate over a column the query types as text, under either spelling', async () => {
    for (const cell of ['<Cell data="$q" col="name" agg="sum" />', '<Number data="$q" col="name" agg="avg" />', '<Cell data="$q" col="day" agg="max" />']) {
      const r = await checkDocumentData(doc(cell), load);
      expect(r.ok, cell).toBe(false);
      if (!r.ok) expect(r.details.join('\n')).toMatch(/\$q.*"(name|day)" is (string|date).*first, last or count/);
    }
  });
});
