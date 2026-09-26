import { expect, it, vi } from 'vitest';
import { prepareJsx } from '@/lib/story/jsx-tier';
import { objectStore } from '@/lib/object-store';
import {queryRows} from '@/lib/datasets/query-rows';
import { inferColumns } from '@/lib/story/dataset-shape';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();
it('real markup preparation validates proposed dataset columns without persistence or fetching', async () => {
  const put = vi.spyOn(objectStore(), 'put').mockImplementation(async () => { throw Error('unexpected persistence'); });
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw Error('unexpected network'); });
  const source = '<Helmet><Import name="q_data" src="ref:abc123" /><Query name="q">{`select amount from q_data.rows`}</Query></Helmet><DataTable data="$q" /><img src="https://example.com/proposed.png" />';
  try {
    const rows = [{ amount: 7 }];
    const loadRef = async (id: string) => id === 'abc123' ? { id, format: 'dataset', columns: inferColumns(rows), query: (sql:string,params:Record<string,import('@artifactbin/contracts').Scalar>) => queryRows({rows,columns:inferColumns(rows)},sql,params) } : null;
    const good = await prepareJsx({}, source, { loadRef });
    expect(good).not.toBeInstanceOf(Response);
    const bad = await prepareJsx({}, source.replace('select amount', 'select missing'), { loadRef });
    expect(bad).toBeInstanceOf(Response);
    expect((bad as Response).status).toBe(400);
    expect(put).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  } finally { put.mockRestore(); network.mockRestore(); }
});
