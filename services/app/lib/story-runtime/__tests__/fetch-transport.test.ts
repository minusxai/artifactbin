/**
 * The top-level document's query transport: a GET of its own query url with
 * the request JSON in `?q=`, no credentials (the document's origin is opaque;
 * the route is credential-blind anyway), failures reported as an Error the
 * store puts on the affected queries.
 */
import { describe, expect, it, vi } from 'vitest';
import { createFetchTransport } from '@/lib/story-runtime/fetch-transport';
import { QUERY_REQUEST_PARAM } from '@/lib/story-runtime/contract';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const requestOf = (f: ReturnType<typeof vi.fn>) => {
  const [url, init] = f.mock.calls[0] as [string, RequestInit | undefined];
  const u = new URL(url, 'http://doc.test');
  return { u, init, q: JSON.parse(u.searchParams.get(QUERY_REQUEST_PARAM) ?? 'null') as unknown };
};

describe('createFetchTransport', () => {
  it('run(): GETs <queryUrl>?q=<{values, only}> and resolves with tables + errors', async () => {
    const f = vi.fn(async () => ok({ tables: { sales: { rows: [{ a: 1 }], columns: [] } }, errors: {} }));
    const t = createFetchTransport('/a/abc123/query', f);
    const r = await t.run({ region: 'EU' }, ['sales']);
    expect(r).toEqual({ tables: { sales: { rows: [{ a: 1 }], columns: [] } }, errors: {} });
    const { u, init, q } = requestOf(f);
    expect(u.pathname).toBe('/a/abc123/query');
    expect(q).toEqual({ values: { region: 'EU' }, only: ['sales'] });
    // A simple GET: no custom headers (no preflight), and explicitly no credentials.
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.credentials).toBe('omit');
  });

  it('page(): sends {values, only:[name], page} and resolves with that table', async () => {
    const f = vi.fn(async () => ok({ tables: { sales: { rows: [{ a: 2 }], columns: [], totalRows: 9 } }, errors: {} }));
    const t = createFetchTransport('/a/abc123/query', f);
    const table = await t.page({ region: 'EU' }, 'sales', { offset: 50, limit: 25, sort: { col: 'a', dir: 'asc' } });
    expect(table.rows).toEqual([{ a: 2 }]);
    expect(requestOf(f).q).toEqual({ values: { region: 'EU' }, only: ['sales'], page: { name: 'sales', offset: 50, limit: 25, sort: { col: 'a', dir: 'asc' } } });
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
});
