import { describe, expect, it } from 'vitest';
import { OFFLINE_FILTER_REASON } from '../file-format';
import { createSnapshotTransport } from '../snapshot-transport';
import { artifactFile, flow } from './fixture';

const snapshot = artifactFile().snapshot;
const revenue = (r: Awaited<ReturnType<ReturnType<typeof createSnapshotTransport>['run']>>, q: string) =>
  (r.tables[q]?.rows[0] as { revenue?: number } | undefined)?.revenue;

describe('createSnapshotTransport', () => {
  const transport = createSnapshotTransport(flow, snapshot);

  it('answers the base values from the base state', async () => {
    const r = await transport.run({ region: null }, ['sales', 'regions']);
    expect(revenue(r, 'sales')).toBe(300);
    expect(r.tables.regions?.rows).toHaveLength(2);
    expect(r.errors).toEqual({});
  });

  it('answers a precomputed filter value from its variant, including queries that read the filtered query', async () => {
    const r = await transport.run({ region: 'east' }, ['sales', 'share']);
    expect(revenue(r, 'sales')).toBe(200);
    expect(revenue(r, 'share')).toBe(20);
  });

  it('keeps answering queries that do not read the changed value from the base state', async () => {
    const r = await transport.run({ region: 'west' }, ['regions']);
    expect(r.tables.regions?.rows).toHaveLength(2);
    expect(r.errors).toEqual({});
  });

  it('reports a value that was not precomputed as an offline error, not a throw', async () => {
    const r = await transport.run({ region: 'north' }, ['sales']);
    expect(r.tables.sales).toBeUndefined();
    expect(r.errors.sales).toBe(OFFLINE_FILTER_REASON);
  });

  it('pages from the same rows', async () => {
    const page = await transport.page({ region: 'west' }, 'sales', { limit: 10, offset: 0 } as never);
    expect(page.rows).toEqual([{ revenue: 100 }]);
  });

  it('cannot write', () => {
    expect(transport.mutate).toBeUndefined();
  });
});
