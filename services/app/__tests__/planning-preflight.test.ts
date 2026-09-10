import { expect, it, vi } from 'vitest';
import { publishJsx } from '@/lib/story/jsx-tier';
import { objectStore } from '@/lib/object-store';
import { parseContentInput } from '@/lib/story/input';
import { inferColumns } from '@/lib/story/dataset-shape';
import { useAppHarness } from '@/__tests__/harness';
import * as datasetStore from '@/lib/story/dataset-store';

useAppHarness();
it('real markup preparation validates proposed dataset columns without persistence or fetching', async () => {
  const put = vi.spyOn(objectStore(), 'put').mockImplementation(async () => { throw Error('unexpected persistence'); });
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw Error('unexpected network'); });
  const source = '<Helmet><Query name="q">{`select amount from ref_abc123`}</Query></Helmet><DataTable data="$q" /><img src="https://example.com/proposed.png" />';
  try {
    const rows = [{ amount: 7 }];
    const loadRef = async (id: string) => id === 'abc123' ? { id, format: 'dataset', columns: inferColumns(rows) } : null;
    const good = await publishJsx({}, source, { loadRef });
    expect(good).not.toBeInstanceOf(Response);
    const bad = await publishJsx({}, source.replace('select amount', 'select missing'), { loadRef });
    expect(bad).toBeInstanceOf(Response);
    expect((bad as Response).status).toBe(400);
    expect(put).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  } finally { put.mockRestore(); network.mockRestore(); }
});
it('legacy row-array preparation needs an ephemeral storage adapter, not only prepareDataset', async () => {
  const put = vi.spyOn(objectStore(), 'put').mockImplementation(async () => { throw Error('unexpected persistence'); });
  // Prototype the extracted persistence capability at the real publication seam.
  const rows = vi.spyOn(datasetStore, 'storeDatasetRows').mockImplementation(async values => ({ content: JSON.stringify(values), objectKey: null }));
  try {
    const proposed = await parseContentInput({ dataset: [{ amount: 7 }] }, {
      prepareDataset: async input => ({ format: 'dataset', source: null, content: JSON.stringify(input), derivedTitle: null, meta: { columns: inferColumns(input as Record<string, unknown>[]) } }),
    });
    expect(proposed).not.toBeInstanceOf(Response); expect(put).not.toHaveBeenCalled();
    expect(rows).toHaveBeenCalledOnce();
  } finally { put.mockRestore(); rows.mockRestore(); }
});
