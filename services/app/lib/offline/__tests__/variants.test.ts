import { describe, expect, it, vi } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import type { Scalar } from '@/lib/story/dataflow';
import { compiledOf } from '@/test/helpers/compiled';
import { precomputeVariants, valueDomains } from '../variants';
import { artifactFile, flow } from './fixture';

const base = artifactFile().snapshot.state;
const nodes = (src: string) => {
  const parsed = parseJsx(src);
  if (!parsed.ok) throw new Error('fixture markup does not parse');
  return parsed.nodes;
};

const FILTERS = '<Value name="region" /><Value name="paid" type="boolean" /><Value name="note" /><Value name="unused" />';
const twoFilters = await compiledOf(`${FILTERS}<Query name="sales">{\`select $region as r, $paid as p, $note as n\`}</Query>`);
const withMe = await compiledOf(`${FILTERS}<Query name="mine">{\`select $_me.id as me, $region as r\`}</Query>`);

describe('valueDomains', () => {
  it('reads a Select bound to a $query, a literal Segmented and a Switch; text inputs have no domain', () => {
    const d = valueDomains(nodes(`<div>
      <Select label="Region" value="$region" options="$regions" placeholder="All regions" />
      <Switch label="Paid" checked="$paid" />
      <Input label="Note" value="$note" />
      <Segmented label="Unused" value="$unused" options={["a","b"]} />
    </div>`), twoFilters, base);
    expect(d.get('region')).toEqual(expect.arrayContaining([null, 'west', 'east']));
    expect(d.get('region')).toHaveLength(3);
    expect(d.get('paid')).toEqual(expect.arrayContaining([true, false]));
    expect(d.get('note')).toBeNull();
    // a Value no query reads is irrelevant offline: it keeps working without precomputation
    expect(d.has('unused')).toBe(false);
  });
});

describe('precomputeVariants', () => {
  const run = vi.fn(async (values: Record<string, Scalar>, only: string[]) => ({
    tables: Object.fromEntries(only.map((q) => [q, { rows: [{ v: JSON.stringify(values) }], columns: [{ name: 'v', type: 'string' as const }] }])),
    errors: {},
  }));

  it('runs every non-base combination of the finite domains and freezes the rest', async () => {
    run.mockClear();
    const domains = new Map<string, Scalar[] | null>([['region', [null, 'west', 'east']], ['paid', [null, true, false]], ['note', null]]);
    const out = await precomputeVariants({ flow: twoFilters, base: { ...base, values: { region: null, paid: null, note: null } }, domains, run });
    expect(out.frozen).toEqual(['note']);
    expect(out.variants).toHaveLength(3 * 3 - 1);
    expect(run).toHaveBeenCalledTimes(8);
    expect(out.variants.every((v) => Object.keys(v.tables).every((q) => q === 'sales'))).toBe(true);
  });

  it('falls back to one Value at a time, then freezes the largest domain, to stay under maxVariants', async () => {
    const domains = new Map<string, Scalar[] | null>([['region', [null, ...Array.from({ length: 30 }, (_, i) => `r${i}`)]], ['paid', [null, true, false]]]);
    const oneAtATime = await precomputeVariants({ flow: twoFilters, base: { ...base, values: { region: null, paid: null } }, domains, run, caps: { maxVariants: 40, maxBytes: 1e9 } });
    expect(oneAtATime.frozen).toEqual([]);
    expect(oneAtATime.variants).toHaveLength(30 + 2);
    const frozen = await precomputeVariants({ flow: twoFilters, base: { ...base, values: { region: null, paid: null } }, domains, run, caps: { maxVariants: 10, maxBytes: 1e9 } });
    expect(frozen.frozen).toEqual(['region']);
    expect(frozen.variants).toHaveLength(2);
  });

  it('stops at the byte budget and freezes what did not fit', async () => {
    const domains = new Map<string, Scalar[] | null>([['region', [null, 'west', 'east']]]);
    const out = await precomputeVariants({ flow, base, domains, run, caps: { maxVariants: 100, maxBytes: 10 } });
    expect(out.variants).toHaveLength(0);
    expect(out.frozen).toEqual(['region']);
  });

  it('does nothing for a document whose queries read no Value', async () => {
    run.mockClear();
    const out = await precomputeVariants({ flow: { ...flow, values: [], queries: flow.queries.slice(0, 1) }, base, domains: new Map(), run });
    expect(out).toEqual({ variants: [], frozen: [] });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('variant values', () => {
  it('carry every relevant Value, frozen ones at their base, so the transport can match on a query\'s params', async () => {
    const run = async (_values: Record<string, Scalar>, only: string[]) => ({ tables: Object.fromEntries(only.map((q) => [q, { rows: [], columns: [] }])), errors: {} });
    const domains = new Map<string, Scalar[] | null>([['region', [null, 'west']], ['paid', null], ['note', null]]);
    const out = await precomputeVariants({ flow: twoFilters, base: { ...base, values: { region: null, paid: true, note: 'x' } }, domains, run });
    expect(out.variants).toEqual([{ values: { region: 'west', paid: true, note: 'x' }, tables: { sales: { rows: [], columns: [] } }, errors: {} }]);
  });

  it('never offers the viewer ($_me.id) as a filter', () => {
    const d = valueDomains(nodes('<Select value="$region" options={["west"]} />'), withMe, base);
    expect([...d.keys()]).toEqual(['region']);
    expect(d.get('region')).toEqual([null, 'west']);
  });
});
