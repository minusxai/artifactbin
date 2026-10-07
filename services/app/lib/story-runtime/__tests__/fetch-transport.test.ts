import {createAuthenticatedTransport} from '../authenticated-transport';
/**
 * The top-level document's query transport: a GET of its own query url with
 * the request JSON in `?q=`, no credentials (the document's origin is opaque;
 * the route is credential-blind anyway), failures reported as an Error the
 * store puts on the affected queries.
 */
import { describe, expect, it, vi } from 'vitest';
import { createFetchTransport } from '@/lib/story-runtime/fetch-transport';
import { QUERY_REQUEST_PARAM } from '@/lib/story-runtime/contract';
import { uploadDatasetImage } from '@/lib/story-runtime/image-upload';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const requestOf = (f: ReturnType<typeof vi.fn>) => {
  const [url, init] = f.mock.calls[0] as [string, RequestInit | undefined];
  const u = new URL(url, 'http://doc.test');
  return { u, init, q: JSON.parse(u.searchParams.get(QUERY_REQUEST_PARAM) ?? 'null') as unknown };
};

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe('createFetchTransport', () => {
  it('run(): GETs <queryUrl>?q=<{values, only}> and resolves with tables + errors', async () => {
    const f = vi.fn(async () => ok({ tables: { sales: { rows: [{ a: 1 }], columns: [] } }, errors: {} }));
    const t = createFetchTransport('/a/abc123/query', f);
    const r = await t.run({ region: 'EU' }, ['sales']);
    expect(r).toEqual({ tables: { sales: { rows: [{ a: 1 }], columns: [] } }, errors: {} });
    const { u, init, q } = requestOf(f);
    expect(u.pathname).toBe('/a/abc123/query');
    // The reader's zone travels with every run: it is $_tz.
    expect(q).toEqual({ values: { region: 'EU' }, only: ['sales'], tz: ZONE });
    // A simple GET: no custom headers (no preflight), and explicitly no credentials.
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.credentials).toBe('omit');
  });

  it('appends the query request to URLs that already have parameters', async () => {
    const f = vi.fn(async () => ok({ tables: {}, errors: {} }));
    await createFetchTransport('/a/abc123/query?token=existing', f).run({}, ['sales']);
    const { u, q } = requestOf(f);
    expect(u.searchParams.get('token')).toBe('existing');
    expect(q).toEqual({ values: {}, only: ['sales'], tz: ZONE });
  });

  it('resolves the default global fetch at request time', async () => {
    const before = vi.fn(async () => ok({ tables: {}, errors: {} }));
    const after = vi.fn(async () => ok({ tables: {}, errors: {} }));
    vi.stubGlobal('fetch', before);
    const transport = createFetchTransport('/a/abc123/query');
    vi.stubGlobal('fetch', after);
    try {
      await transport.run({}, ['sales']);
      expect(before).not.toHaveBeenCalled();
      expect(after).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('run(): POSTs local table snapshots instead of placing them in a bounded URL', async () => {
    const f = vi.fn(async () => ok({ tables: {}, errors: {} }));
    const t = createFetchTransport('/a/abc123/query', f);
    await t.run({}, ['total'], { cart: [{ id: 1 }] });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/a/abc123/query');
    expect(init).toMatchObject({method: 'POST', credentials: 'omit', headers: {'Content-Type': 'text/plain'}});
    expect(JSON.parse(String(init.body))).toEqual({ values: {}, only: ['total'], tz: ZONE, localTables: { cart: [{ id: 1 }] } });
  });

  it('page(): sends {values, only:[name], page} and resolves with that table', async () => {
    const f = vi.fn(async () => ok({ tables: { sales: { rows: [{ a: 2 }], columns: [], totalRows: 9 } }, errors: {} }));
    const t = createFetchTransport('/a/abc123/query', f);
    const table = await t.page({ region: 'EU' }, 'sales', { offset: 50, limit: 25, sort: { col: 'a', dir: 'asc' } });
    expect(table.rows).toEqual([{ a: 2 }]);
    expect(requestOf(f).q).toEqual({ values: { region: 'EU' }, only: ['sales'], page: { name: 'sales', offset: 50, limit: 25, sort: { col: 'a', dir: 'asc' } }, tz: ZONE });
  });

  it('page() rejects with the query\'s own error when the table is missing', async () => {
    const f = vi.fn(async () => ok({ tables: {}, errors: { sales: 'Binder Error: no such column' } }));
    await expect(createFetchTransport('/a/x/query', f).page({}, 'sales', { offset: 0, limit: 10 })).rejects.toThrow(/Binder Error/);
  });

  it('a non-OK response rejects with the status — a private document (404) reads as a failed query, never a hang', async () => {
    const f = vi.fn(async () => new Response('{"error":"not_found"}', { status: 404 }));
    await expect(createFetchTransport('/a/x/query', f).run({}, ['q'])).rejects.toThrow(/404/);
  });

  it('a network failure rejects with the error message', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(createFetchTransport('/a/x/query', f).run({}, ['q'])).rejects.toThrow(/Failed to fetch/);
  });

  it('mutate(): carries the current local table snapshot to the document endpoint', async () => {
    const f = vi.fn(async () => ok({ ok: true, dataset: '', local: { target: 'cart', table: { columns: [], rows: [] } } }));
    const t = createFetchTransport('/a/x/query', f, '/a/x/mutate');
    await expect(t.mutate!({ mutation: 'add', args: {}, localTables: { cart: [{ id: 1 }] } })).resolves.toMatchObject({ local: { target: 'cart' } });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ tz: ZONE, mutation: 'add', args: {}, localTables: { cart: [{ id: 1 }] } });
  });

  it('people(): POSTs the ids credential-free, as a simple request, and answers the cards the door named', async () => {
    const cards = { usr_a: { name: 'A', handle: null, image: null } };
    const f = vi.fn(async () => ok({ people: cards }));
    const t = createFetchTransport('/a/abc123/query', f);
    await expect(t.people!(['usr_a', 'usr_b'])).resolves.toEqual(cards);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/a/abc123/query');
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'text/plain' } });
    expect(JSON.parse(String(init.body))).toEqual({ people: ['usr_a', 'usr_b'] });
    await expect(createFetchTransport('/a/x/query', vi.fn(async () => new Response('{}', { status: 404 }))).people!(['usr_a'])).rejects.toThrow('404');
  });

  it('hold(): POSTs one import\'s name to the scoped door — a dataset\'s rows are no URL\'s business — credential-free, and refuses what the door refuses', async () => {
    const rows = { rows: { rows: [{ a: 1 }], columns: [{ name: 'a', type: 'number' }] } };
    const f = vi.fn(async () => ok({ tables: rows }));
    const t = createFetchTransport('/a/abc123/query', f);
    await expect(t.hold!('sales')).resolves.toEqual(rows);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/a/abc123/query');
    // A simple request (text/plain, no credential): the POST door answers it with the anonymous read and CORS `*`, as the GET door does.
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'text/plain' } });
    expect(JSON.parse(String(init.body))).toEqual({ hold: 'sales' });
    const refused = createFetchTransport('/a/abc123/query', vi.fn(async () => new Response('{"error":"not_holdable"}', { status: 404 })));
    await expect(refused.hold!('sales')).rejects.toThrow('404');
  });

  it('with the session (a signed-in page): every door is a POST that carries it — runs, windows, holds, people and writes', async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => ok(String(init?.body).includes('"mutation"') ? { ok: true, dataset: 'DS1' } : { tables: { sales: { rows: [], columns: [] } }, errors: {}, people: {} }));
    const t = createFetchTransport('/a/abc123/query', f, '/a/abc123/mutate', { session: true });
    await t.run({ region: 'EU' }, ['sales']);
    await t.page({}, 'sales', { offset: 0, limit: 10 });
    await t.hold!('sales').catch(() => {});
    await t.people!(['usr_a']);
    await t.mutate!({ mutation: 'vote', args: {} });
    const calls = f.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([url, init]) => [url, init.method, init.credentials])).toEqual([
      ['/a/abc123/query', 'POST', 'same-origin'], ['/a/abc123/query', 'POST', 'same-origin'], ['/a/abc123/query', 'POST', 'same-origin'],
      ['/a/abc123/query', 'POST', 'same-origin'], ['/a/abc123/mutate', 'POST', 'same-origin'],
    ]);
    expect(JSON.parse(String(calls[0]![1].body))).toMatchObject({ values: { region: 'EU' }, only: ['sales'] });
  });

  it('uploads files only through the signed-in dataset door and reuses a file key on retry',async()=>{
    const f=vi.fn(async()=>ok({ref:'dimg:abc234def456',url:'/a/abc123/datasets/data12/images/abc234def456'}));
    const transport=createFetchTransport('/a/abc123/query',f,undefined,{session:true,credentials:'include'});
    const file=new File(['png'], 'screen.png',{type:'image/png'});
    const context=transport.image!;
    await uploadDatasetImage(context,'data12','edit-key',file);
    await uploadDatasetImage(context,'data12','edit-key',file);
    const first=f.mock.calls[0] as unknown as [string,RequestInit],second=f.mock.calls[1] as unknown as [string,RequestInit];
    expect(first[0]).toMatch(/\/a\/abc123\/datasets\/data12\/images$/);
    expect(first[1]).toMatchObject({method:'POST',credentials:'include'});
    const key1=(first[1].headers as Record<string,string>)['Idempotency-Key'],key2=(second[1].headers as Record<string,string>)['Idempotency-Key'];
    expect(key1).toBe(key2);
    expect(first[1].headers).toMatchObject({'X-Edit-Id':'edit-key'});
    expect(first[1].body).toBe(file);
    await expect(uploadDatasetImage(createFetchTransport('/a/abc123/query',f).image,'data12','edit-key',file)).rejects.toThrow(/signed-in/);
  });

  it('preserves actionable ACL failures from the image door',async()=>{
    const context=createFetchTransport('/a/abc123/query',vi.fn(async()=>Response.json({detail:'No insert grant permits this upload'},{status:403})),undefined,{session:true}).image;
    await expect(uploadDatasetImage(context,'data12','edit-key',new File(['x'],'x.png',{type:'image/png'}))).rejects.toThrow('No insert grant permits this upload');
  });
});

it('preserves a saved operation key and discoverable run id through direct transport',async()=>{
 const f=vi.fn(async(_url:unknown,_options?:RequestInit)=>Response.json({ok:true,dataset:'data',mutationRunId:'run'}));
 const transport=createFetchTransport('/a/x/query',f,'/a/x/mutate');
 const request={mutation:'add',args:{},operationKey:'saved-operation-key',tz:'UTC'};
 expect(await transport.mutate!(request)).toEqual({dataset:'data',mutationRunId:'run'});
 expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toMatchObject(request);
});

it('retains the run handle on the authenticated page transport',async()=>{
 const transport=createAuthenticatedTransport('doc',async()=>Response.json({ok:true,dataset:'data',mutationRunId:'run'}));
 expect(await transport.mutate!({mutation:'add',args:{},operationKey:'saved-operation-key'})).toEqual({dataset:'data',mutationRunId:'run'});
 transport.dispose();
});
