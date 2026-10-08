import { afterEach, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/my/datasets/import/route';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { MAX_ROWS_LIMIT } from '@/lib/platform/config';
import { request, useAppHarness } from './harness';

const harness = useAppHarness();
const path = '/api/my/datasets/import';
afterEach(() => vi.unstubAllGlobals());
async function ingest(json: unknown) {
  const { token } = await mintToken('dataset-import');
  return POST(request(path, { method: 'POST', token, json }));
}

it('returns typed CSV rows without publishing an artifact', async () => {
  const response = await ingest({ kind: 'csv', text: 'name,score\n"Ada, A",42' });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ rows: [{ name: 'Ada, A', score: 42 }], rowCount: 1, totalRows: 1, truncated: false });
  const db = await harness.db();
  expect((await db.query('SELECT id FROM artifacts')).rows).toHaveLength(0);
});

it('fetches the selected public Google Sheet tab using the existing importer', async () => {
  const fetch = vi.fn(async () => new Response('name,score\nAda,42', { headers: { 'Content-Type': 'text/csv' } }));
  vi.stubGlobal('fetch', fetch);
  const response = await ingest({ kind: 'sheetUrl', url: 'https://docs.google.com/spreadsheets/d/example/edit#gid=7' });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ rows: [{ name: 'Ada', score: 42 }] });
  expect(fetch).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/example/export?format=csv&gid=7', expect.anything());
});

it('requires authentication before fetching remote data', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect((await POST(request(path, { method: 'POST', json: { kind: 'sheetUrl', url: 'https://docs.google.com/spreadsheets/d/example/edit' } }))).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});

it.each([{ kind: 'csv', text: 3 }, { kind: 'sheetUrl' }, { kind: 'csvUrl', url: 'https://example.com/a.csv' }])('rejects malformed import input %j', async source => {
  expect((await ingest(source)).status).toBe(400);
});

it('returns actionable sheet errors and rejects arbitrary URLs without fetching', async () => {
  const fetch = vi.fn(async () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }));
  vi.stubGlobal('fetch', fetch);
  const invalid = await ingest({ kind: 'sheetUrl', url: 'https://example.com/a.csv' });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({ code: 'not_a_sheet_url' });
  expect(fetch).not.toHaveBeenCalled();
  const privateSheet = await ingest({ kind: 'sheetUrl', url: 'https://docs.google.com/spreadsheets/d/private/edit' });
  expect(privateSheet.status).toBe(400);
  expect(await privateSheet.json()).toMatchObject({ code: 'sheet_not_public', details: [expect.stringContaining('not publicly readable')] });
});

it('reports row truncation and rejects empty CSV', async () => {
  const response = await ingest({ kind: 'csv', text: ['n', ...Array(MAX_ROWS_LIMIT + 1).fill('1')].join('\n') });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ rowCount: MAX_ROWS_LIMIT, totalRows: MAX_ROWS_LIMIT + 1, truncated: true });
  const empty = await ingest({ kind: 'csv', text: 'name,score' });
  expect(empty.status).toBe(400);
  expect(await empty.json()).toMatchObject({ code: 'empty' });
});
