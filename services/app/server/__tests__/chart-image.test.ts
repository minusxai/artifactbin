/**
 * The query image's doors against the real handlers: `POST /api/charts/image` for a signed-in caller, the identity
 * owner's fixed seam, and `sql.mjs query … --chart` drawing a read through the real route.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, onTestFinished } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import { ANONYMOUS, CANONICAL_CHART_IMAGE_PATH, SERVICE_PAYLOAD_LIMIT } from '@artifactbin/contracts';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';
import { POST as drawRoute } from '@/app/api/charts/image/route';
import { sqlCommand } from '../../skills/artifactbin/scripts/sql.mjs';
import { createAppServer } from '../app';
import {tempDir} from '@artifactbin/test-support/temp-dir';

useAppHarness();
const chart = { mark: 'bar', encoding: { x: { field: 'k', type: 'nominal' }, y: { field: 'v', type: 'quantitative' } } };
const rows = [{ k: 'north', v: 3 }, { k: 'south', v: 5 }];
const isPng = async (data: string, width: number, height: number) => {
  const meta = await sharp(Buffer.from(data, 'base64')).metadata();
  expect([meta.format, meta.width, meta.height]).toEqual(['png', width, height]);
};

describe('POST /api/charts/image', () => {
  it('draws the caller\'s rows for any signed-in caller and refuses what it cannot draw', async () => {
    const { token } = await mintAccountToken('mxmx_test_chart_image');
    const post = (json: unknown, options: { token?: string; body?: string } = { token }) =>
      drawRoute(request('/api/charts/image', { method: 'POST', ...options, ...(options.body === undefined ? { json } : {}) }));
    const drawn = await post({ chart, rows, width: 480, height: 300, designSystem: 'riso', theme: 'dark' });
    expect(drawn.status).toBe(200);
    const body = await drawn.json();
    expect(body).toEqual({ mime: 'image/png', width: 480, height: 300, bytes: expect.any(Number), data: expect.any(String) });
    expect(Buffer.from(body.data, 'base64')).toHaveLength(body.bytes);
    await isPng(body.data, 480, 300);
    expect((await post({ chart, rows }, {})).status).toBe(401);
    const invalid = await post({ chart: { recipe: 'pie', bindings: {} }, rows });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'invalid_chart', message: expect.stringContaining('unknown recipe "pie"') });
    const huge = await post(undefined, { token, body: JSON.stringify({ chart, rows: [{ k: 'x'.repeat(SERVICE_PAYLOAD_LIMIT) }] }) });
    expect(huge.status).toBe(413);
    expect(await huge.json()).toMatchObject({ error: 'too_large', hint: expect.stringContaining('aggregate') });
    expect((await post(undefined, { token, body: '[1]' })).status).toBe(400);
  });
});

describe('the identity owner\'s chart seam', () => {
  it('draws only what the owner forwards, with exact keys', async () => {
    const app = createAppServer({ indexHtml: async () => '<html></html>' });
    const seam = (body: unknown, actor: Parameters<typeof attachActor>[1] | null = ANONYMOUS) => {
      const req = new Request('http://localhost' + CANONICAL_CHART_IMAGE_PATH, { method: 'POST', body: JSON.stringify(body) });
      return app.fetch(actor ? attachActor(req, actor) : req);
    };
    const drawn = await seam({ chart, rows, width: 200, height: 160 });
    expect(drawn.status).toBe(200);
    expect(drawn.headers.get('cache-control')).toBe('no-store');
    await isPng((await drawn.json()).data, 200, 160);
    // A direct request (no actor) or anyone's forwarded one is not the owner's relay.
    expect((await seam({ chart, rows }, null)).status).toBe(403);
    expect((await seam({ chart, rows }, { credential: 'session', userId: 'usr_1' })).status).toBe(403);
    for (const body of [{ chart }, { chart, rows, grant: 'x' }]) expect((await seam(body)).status).toBe(400);
    const refused = await seam({ chart, rows, width: 9 });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe('invalid_request');
  });
});

describe('sql.mjs query --chart', () => {
  it('draws a dataset, page or default read through the route into a new PNG, and refuses what it cannot draw before querying', async () => {
    const { token } = await mintAccountToken('mxmx_test_chart_sql');
    const root = await tempDir('chart-sql-',onTestFinished), spec = path.join(root, 'bar.json');
    const server = 'https://example.test', sent: string[] = [];
    let readRows: unknown[] = rows;
    const options = { env: { ARTIFACTBIN_URL: server, ARTIFACTBIN_TOKEN: token, ARTIFACTBIN_HOME: root }, fetcher: async (url: string, init: RequestInit) => {
      const route = new URL(url).pathname;
      sent.push(route);
      // The real route and its token check; everything else is the read the chart draws.
      if (route === '/api/charts/image') return drawRoute(new Request('http://localhost:3000' + route, init));
      if (route === '/api/artifacts/DATA12') return Response.json({ id: 'DATA12', format: 'dataset', version: 2 });
      if (route === '/api/artifacts/PAGE12') return Response.json({ id: 'PAGE12', format: 'html', version: 3 });
      if (route === '/api/artifacts/DATA12/query') return Response.json({ results: [{ columns: [{ name: 'k' }, { name: 'v' }], rows: readRows, next_cursor: null }] });
      if (route === '/api/artifacts/PAGE12/sql') return Response.json({ columns: [{ name: 'k' }, { name: 'v' }], rows: readRows });
      if (route === '/api/default-connection/sql') return Response.json({ columns: [{ name: 'k' }, { name: 'v' }], rows });
      return Response.json({ error: 'not_found' }, { status: 404 });
    } };
    const query = (target: string, sql: string, values: Record<string, unknown>): Promise<any> => sqlCommand({ sub: 'query', values, positionals: [target, sql] }, options);
      await writeFile(spec, JSON.stringify(chart));
      const out = path.join(root, 'dataset.png');
      const read = await query('DATA12', 'select k, v from rows', { chart: spec, 'chart-output': out, 'chart-width': '320', 'chart-height': '200', 'chart-theme': 'dark' });
      expect(read).toEqual({ columns: [{ name: 'k' }, { name: 'v' }], rows, chart: { output: out, width: 320, height: 200, bytes: expect.any(Number) } });
      const png = await readFile(out);
      expect(png).toHaveLength(read.chart.bytes);
      await isPng(png.toString('base64'), 320, 200);
      // Never over an existing file, and that is known before anything is queried.
      sent.length = 0;
      await expect(query('DATA12', 'select k, v from rows', { chart: spec, 'chart-output': out })).rejects.toMatchObject({ code: 'output_exists', exit: 2 });
      expect(sent).toEqual([]);
      const page = await query('PAGE12', 'select k, v from t', { chart: spec, 'chart-output': path.join(root, 'page.png') });
      expect(page.chart).toMatchObject({ width: 640, height: 400 });
      const warehouse = await query('default:shop', 'select k, v from sales', { chart: spec, 'chart-output': path.join(root, 'default.png') });
      expect(warehouse.chart).toMatchObject({ width: 640, height: 400 });

      sent.length = 0;
      for (const [sql, target] of [['insert into rows (k) values (1)', 'DATA12'], ['delete from t', 'PAGE12'], ['update t set v = 1', 'default:shop']]) {
        await expect(query(target!, sql!, { chart: spec, 'chart-output': path.join(root, 'write.png') })).rejects.toMatchObject({ code: 'chart_read_only', exit: 2 });
      }
      await expect(sqlCommand({ sub: 'schema', values: { chart: spec, 'chart-output': path.join(root, 's.png') }, positionals: ['DATA12'] }, options)).rejects.toMatchObject({ code: 'chart_read_only' });
      await expect(query('DATA12', 'select 1', { chart: spec })).rejects.toMatchObject({ code: 'invalid_arguments', exit: 2 });
      await expect(query('DATA12', 'select 1', { chart: path.join(root, 'missing.json'), 'chart-output': path.join(root, 'm.png') })).rejects.toMatchObject({ exit: 2 });
      await expect(query('DATA12', 'select 1', { chart: spec, 'chart-output': path.join(root, 'w.png'), 'chart-width': '5000' })).rejects.toMatchObject({ code: 'invalid_chart-width', exit: 2 });
      expect(sent).toEqual([]);

      // The server's reason reaches the caller; the rows stay under the relay's request cap.
      await writeFile(spec, JSON.stringify({ recipe: 'pie', bindings: {} }));
      await expect(query('DATA12', 'select k, v from rows', { chart: spec, 'chart-output': path.join(root, 'bad.png') }))
        .rejects.toMatchObject({ code: 'invalid_chart', message: expect.stringContaining('Chart refused: unknown recipe "pie"') });
      await writeFile(spec, JSON.stringify(chart));
      readRows = Array.from({ length: 10000 }, (_, i) => ({ k: `${'a longer category name '.repeat(20)}${i}`, v: i }));
      sent.length = 0;
      await expect(query('DATA12', 'select k, v from rows', { chart: spec, 'chart-output': path.join(root, 'big.png'), limit: '10000' }))
        .rejects.toMatchObject({ code: 'chart_rows_too_large', recovery: expect.stringContaining('Aggregate in SQL') });
      expect(sent).not.toContain('/api/charts/image');
  });
});
