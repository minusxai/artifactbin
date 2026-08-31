/**
 * Ingest through the REAL route handler.
 *
 * The unit tests cover parsing and coercion in isolation. What they cannot see
 * is the wiring — and the wiring is exactly where this feature broke: declaring
 * a column type collided with coercion instead of overriding it, and the symptom
 * was a `400 invalid_dataset` from *publishDataset*, two layers away from the
 * code that caused it. A unit test on coerceRows would never have caught that.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST as createArtifact } from '@/app/api/artifacts/route';

import { mintToken } from '@/lib/tokens';

import { loadDatasetRows } from '@/lib/story/dataset-store';
import { MAX_ROWS_LIMIT } from '@/lib/config';
import { useAppHarness } from '@/__tests__/harness';

const harness = useAppHarness();

const BASE = 'http://localhost:3000';
let token: string;

beforeEach(async () => {
  token = (await mintToken('ingest-test')).token;
});

afterEach(() => vi.unstubAllGlobals());

const create = async (body: Record<string, unknown>) => {
  const res = await createArtifact(new Request(`${BASE}/api/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
};

/** The stored rows, as a chart would read them — wherever they actually live. */
const storedRows = async (id: string) => {
  const db = await harness.db();
  const r = await db.query<{ content: string; meta: unknown }>('SELECT content, meta FROM artifacts WHERE id = $1', [id]);
  return loadDatasetRows(r.rows[0]);
};

describe('CSV text through the route', () => {
  it('creates a dataset with COERCED types, not all-strings', async () => {
    const { status, body } = await create({ title: 'sales', dataset: 'month,revenue,zip\n2026-01,120,01234' });
    expect(status).toBe(201);
    expect(body.format).toBe('dataset');
    expect(body.columns).toEqual([
      { name: 'month', type: 'string' },
      { name: 'revenue', type: 'number' }, // the whole point — Vega needs this
      { name: 'zip', type: 'string' },     // leading zero survived
    ]);
    expect(await storedRows(body.id)).toEqual([{ month: '2026-01', revenue: 120, zip: '01234' }]);
  });

  it('reports ingest failures with a machine-readable code', async () => {
    const { status, body } = await create({ title: 'x', dataset: 'a,b' }); // header only
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: 'invalid_dataset', code: 'empty' });
  });

  it('keeps the first MAX_ROWS_LIMIT rows and SAYS what it left out', async () => {
    // A big sheet is a legitimate source: 200k rows import fine and then make an
    // unloadable page, because every row is fetched, parsed and serialized into
    // the document. So a dataset is a sample until there is a query layer — and
    // the true count is reported, because a chart built from 5% of the data
    // while claiming to be the whole set is the failure this tier exists to avoid.
    const csv = ['n', ...Array(MAX_ROWS_LIMIT + 500).fill('1')].join('\n');
    const { status, body } = await create({ title: 'big', dataset: csv });
    expect(status).toBe(201);
    expect(body.rowCount).toBe(MAX_ROWS_LIMIT);
    expect(body.totalRows).toBe(MAX_ROWS_LIMIT + 500);
    expect(body.truncated).toBe(true);
    expect(body.note).toContain(String(MAX_ROWS_LIMIT + 500));
    expect(await storedRows(body.id)).toHaveLength(MAX_ROWS_LIMIT);
  });

  it('does not mark a small dataset as truncated', async () => {
    const { body } = await create({ title: 'small', dataset: 'n\n1\n2' });
    expect(body.rowCount).toBe(2);
    expect(body.truncated).toBeUndefined();
  });
});

describe('declared columns win over the sniffer (regression)', () => {
  it('accepts a numeric-looking column declared as string — this used to 400', async () => {
    // The exact request that failed: coercion made `code` a number, then
    // publishDataset rejected it against the declaration.
    const { status, body } = await create({
      title: 'ids',
      dataset: 'code,amount\n120,5\n150,7',
      columns: [{ name: 'code', type: 'string' }],
    });
    expect(status).toBe(201);
    expect(body.columns).toEqual([
      { name: 'code', type: 'string' },
      { name: 'amount', type: 'number' },
    ]);
    expect(await storedRows(body.id)).toEqual([
      { code: '120', amount: 5 },
      { code: '150', amount: 7 },
    ]);
  });

  it('forces a number where the sniffer would have kept text', async () => {
    const { body } = await create({
      title: 'zips as numbers',
      dataset: 'zip\n01234',
      columns: [{ name: 'zip', type: 'number' }],
    });
    expect(await storedRows(body.id)).toEqual([{ zip: 1234 }]);
  });
});

describe('public sheet through the route', () => {
  it('imports a sheet as a dataset', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('a,b\n1,x', { headers: { 'Content-Type': 'text/csv' } })) as unknown as typeof fetch);
    const { status, body } = await create({ title: 'sheet', sheetUrl: 'https://docs.google.com/spreadsheets/d/abc123/edit#gid=0' });
    expect(status).toBe(201);
    expect(await storedRows(body.id)).toEqual([{ a: 1, b: 'x' }]);
  });

  it('refuses a sheet that is not public, with the reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!DOCTYPE html>', { status: 404, headers: { 'Content-Type': 'text/html' } })) as unknown as typeof fetch);
    const { status, body } = await create({ title: 'x', sheetUrl: 'https://docs.google.com/spreadsheets/d/abc123/edit' });
    expect(status).toBe(400);
    expect(body.code).toBe('sheet_not_public');
    expect(body.details[0]).toMatch(/anyone with the link/i); // actionable, not just "failed"
  });

  it('never fetches a non-Sheets URL', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy as unknown as typeof fetch);
    const { status, body } = await create({ title: 'x', sheetUrl: 'https://evil.example.com/data.csv' });
    expect(status).toBe(400);
    expect(body.code).toBe('not_a_sheet_url');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('the JSON array path is unchanged', () => {
  it('still accepts already-typed rows without going through ingest', async () => {
    const { status, body } = await create({ title: 'json', dataset: [{ a: 1, b: 'x' }] });
    expect(status).toBe(201);
    expect(body.columns).toEqual([{ name: 'a', type: 'number' }, { name: 'b', type: 'string' }]);
    expect(await storedRows(body.id)).toEqual([{ a: 1, b: 'x' }]);
  });

  it('still rejects a nested value', async () => {
    const { status, body } = await create({ title: 'nested', dataset: [{ a: { b: 1 } }] });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_dataset');
  });

  it('still rejects an empty array', async () => {
    expect((await create({ title: 'empty', dataset: [] })).status).toBe(400);
  });
});

describe('rows live in the object store, not the database column', () => {
  it('leaves artifacts.content EMPTY and records the key in meta', async () => {
    // The whole point of the change: a 27 MB sheet must not sit in a column
    // that every render and every /edits write reads and parses.
    const { body } = await create({ title: 'stored', dataset: 'month,revenue\n2026-01,120' });
    const db = await harness.db();
    const row = (await db.query<{ content: string; meta: { objectKey?: string; rowCount?: number } }>(
      'SELECT content, meta FROM artifacts WHERE id = $1', [body.id],
    )).rows[0];
    expect(row.content).toBe('');
    expect(row.meta.objectKey).toMatch(/^dataset\/[0-9a-f]{32}$/);
    // Metadata stays in the row, so listing and binding need no object fetch.
    expect(row.meta.rowCount).toBe(1);
    expect(body.columns).toEqual([{ name: 'month', type: 'string' }, { name: 'revenue', type: 'number' }]);
  });

  it('is content-addressed — the same data twice reuses one object', async () => {
    const a = await create({ title: 'one', dataset: 'a\n1' });
    const b = await create({ title: 'two', dataset: 'a\n1' });
    const db = await harness.db();
    const keys = (await db.query<{ meta: { objectKey?: string } }>(
      'SELECT meta FROM artifacts WHERE id = ANY($1)', [[a.body.id, b.body.id]],
    )).rows.map((r) => r.meta.objectKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it('answers [] for a row with no object key — rows live in the store, full stop', async () => {
    // Pre-object-store inline rows are a retired shape (pre-production, no
    // back-compat): a row without a key has no rows, not hidden ones.
    const { body } = await create({ title: 'legacy', dataset: 'a\n1' });
    const db = await harness.db();
    await db.query(`UPDATE artifacts SET content = '[{"a":42}]', meta = meta - 'objectKey' WHERE id = $1`, [body.id]);
    const row = (await db.query<{ content: string; meta: unknown }>('SELECT content, meta FROM artifacts WHERE id = $1', [body.id])).rows[0];
    expect(await loadDatasetRows(row)).toEqual([]);
  });
});

describe('the read-back API carries dataset ROWS', () => {
  it('returns rows, so the editor can resolve refs client-side', async () => {
    // The editor resolves refs through this endpoint. It used to parse them out
    // of `content`, which is empty now that rows live in the object store — so
    // every chart rendered "data unavailable" in EDIT mode while view mode,
    // which resolves server-side, was fine.
    const { body } = await create({ title: 'ds', dataset: 'month,revenue\n2026-01,120' });
    const { GET } = await import('@/app/api/artifacts/[id]/route');
    const res = await GET(
      new Request(`http://localhost:3000/api/artifacts/${body.id}`, { headers: { Authorization: `Bearer ${token}` } }),
      { params: Promise.resolve({ id: body.id }) },
    );
    const wire = await res.json();
    expect(wire.rows).toEqual([{ month: '2026-01', revenue: 120 }]);
    expect(wire.columns).toEqual([{ name: 'month', type: 'string' }, { name: 'revenue', type: 'number' }]);
  });
});
