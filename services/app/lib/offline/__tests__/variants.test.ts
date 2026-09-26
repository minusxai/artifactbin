import { describe, expect, it, vi } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import type { Dataflow, Scalar } from '@/lib/story/dataflow';
import { precomputeVariants, valueDomains } from '../variants';
import { artifactFile, flow } from './fixture';

const base = artifactFile().snapshot.state;
const nodes = (src: string) => {
  const parsed = parseJsx(src);
  if (!parsed.ok) throw new Error('fixture markup does not parse');
  return parsed.nodes;
};

const twoFilters: Dataflow = {
  values: [
    { kind: 'scalar', name: 'region', type: 'string', default: null, start: 0, end: 0 },
    { kind: 'scalar', name: 'paid', type: 'boolean', default: null, start: 0, end: 0 },
    { kind: 'scalar', name: 'note', type: 'string', default: null, start: 0, end: 0 },
    { kind: 'scalar', name: 'unused', type: 'string', default: null, start: 0, end: 0 },
  ],
  queries: [{ name: 'sales', sql: 'x', params: ['region', 'paid', 'note'], refs: [], start: 0, end: 0 }],
};

describe('valueDomains', () => {
  it('reads a Select bound to a $query, a literal Segmented and a Switch; text inputs have no domain', () => {
    const d = valueDomains(nodes(`<div>
      <Select label="Region" value="$region" options="$regions" placeholder="All regions" />
      <Switch label="Paid" value="$paid" />
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
    const out = await precomputeVariants({ flow: { values: [], queries: flow.queries.slice(0, 1) }, base, domains: new Map(), run });
    expect(out).toEqual({ variants: [], frozen: [] });
    expect(run).not.toHaveBeenCalled();
  });
});
