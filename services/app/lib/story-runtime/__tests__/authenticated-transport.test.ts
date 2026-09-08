import { expect, it, vi } from 'vitest';
import { createAuthenticatedTransport } from '../authenticated-transport';

it('uses scoped authenticated doors and cancels requests at document disposal', async () => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ok:true,dataset:'data',tables:{},errors:{},url:'/assets/cached'})));
  const transport = createAuthenticatedTransport('AbC123', fetcher);
  await transport.run({}, []);
  await transport.mutate!({}, 'save');
  await transport.importAsset!('https://example.com/a.png', 'image');
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/a/AbC123/query','/a/AbC123/mutate','/a/AbC123/assets?u=https%3A%2F%2Fexample.com%2Fa.png&kind=image']);
  for (const call of fetcher.mock.calls) expect(call[1]).toMatchObject({credentials:'same-origin'});
  const signal = fetcher.mock.calls[0][1]!.signal!;
  transport.dispose();
  expect(signal.aborted).toBe(true);
  await expect(transport.run({}, [])).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(3);
});
