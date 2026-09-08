import { expect, it, vi } from 'vitest';
import { createAuthenticatedTransport } from '../authenticated-transport';

it('returns an explicit asset refusal so bound images clear stale content',async()=>{
  const transport=createAuthenticatedTransport('AbC123',vi.fn(async()=>new Response(JSON.stringify({error:'blocked_address',detail:'destination is not public'}),{status:403})));
  await expect(transport.importAsset!('https://private.test/a.png','image')).resolves.toEqual({refused:'blocked_address'});
  transport.dispose();
});
it('does not return data whose response body settles after document disposal',async()=>{
  let finish!:(value:unknown)=>void;
  const body=new Promise(resolve=>{finish=resolve;});
  const response={ok:true,json:()=>body} as Response;
  const transport=createAuthenticatedTransport('AbC123',vi.fn(async()=>response));
  const pending=transport.run({},[]);await Promise.resolve();transport.dispose();finish({tables:{},errors:{}});
  await expect(pending).rejects.toThrow();
});

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
