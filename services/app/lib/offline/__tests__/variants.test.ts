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

type Runs = Array<{ values: Record<string, Scalar>; only: string[] }>;
/** A batch runner from a one-run function, as the engine answers: one result per run, in order. */
const batched = (one: (values: Record<string, Scalar>, only: string[]) => Promise<{ tables: Record<string, unknown>; errors: Record<string, string> }>) =>
  vi.fn(async (runs: Runs) => Promise.all(runs.map((r) => one(r.values, r.only))) as never);

describe('precomputeVariants', () => {
  const run = batched(async (values, only) => ({
    tables: Object.fromEntries(only.map((q) => [q, { rows: [{ v: JSON.stringify(values) }], columns: [{ name: 'v', type: 'string' as const }] }])),
    errors: {},
  }));

  it('runs every non-base combination of the finite domains and freezes the rest', async () => {
    run.mockClear();
    const domains = new Map<string, Scalar[] | null>([['region', [null, 'west', 'east']], ['paid', [null, true, false]], ['note', null]]);
    const out = await precomputeVariants({ flow: twoFilters, base: { ...base, values: { region: null, paid: null, note: null } }, domains, run });
    expect(out.frozen).toEqual(['note']);
    expect(out.variants).toHaveLength(3 * 3 - 1);
    // Every combination in ONE engine call: the imports are loaded once for all of them.
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toHaveLength(8);
    expect(out.variants.every((v) => Object.keys(v.tables).every((q) => q === 'sales'))).toBe(true);
  });

  it('runs a plan in batches yet keeps the plan order and the byte budget', async () => {
    const slow = run;
    const domains = new Map<string, Scalar[] | null>([['region', [null, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']]]);
    const state = { ...base, values: { region: null } };
    const all = await precomputeVariants({ flow, base: state, domains, run: slow, caps: { maxVariants: 100, maxBytes: 1e9 } });
    expect(all.variants.map((v) => v.values.region)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    // Budget for exactly three variants: the first three in plan order survive, the rest freeze the Value.
    const one = new TextEncoder().encode(JSON.stringify(all.variants[0])).length;
    const capped = await precomputeVariants({ flow, base: state, domains, run: slow, caps: { maxVariants: 100, maxBytes: one * 3 + 8 } });
    expect(capped.variants).toEqual([]);
    expect(capped.frozen).toEqual(['region']);
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

  it('leaves out a result equal to the base one: the transport answers it from the base', async () => {
    const state = { values: { region: null, paid: null, note: null }, tables: { sales: { rows: [{ v: 'base' }], columns: [{ name: 'v', type: 'string' as const }] } }, errors: {} };
    // Only `region` changes the result; `paid` leaves it as the base has it.
    const same = batched(async (values, only) => ({ tables: Object.fromEntries(only.map((q) => [q, values.region === null ? state.tables.sales : { rows: [{ v: String(values.region) }], columns: state.tables.sales.columns }])), errors: {} }));
    const domains = new Map<string, Scalar[] | null>([['region', [null, 'west']], ['paid', [null, true]]]);
    const out = await precomputeVariants({ flow: twoFilters, base: state, domains, run: same });
    expect(out.variants).toHaveLength(3);
    expect(out.variants.find((v) => v.values.region === null && v.values.paid === true)!.tables).toEqual({});
    expect(out.variants.filter((v) => v.values.region === 'west').every((v) => v.tables.sales!.rows[0]!.v === 'west')).toBe(true);
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
    const run = batched(async (_values, only) => ({ tables: Object.fromEntries(only.map((q) => [q, { rows: [], columns: [] }])), errors: {} }));
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
