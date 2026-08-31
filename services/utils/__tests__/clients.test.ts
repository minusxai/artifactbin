/** The HTTP clients live in utils, so a lean app depends on no service package; the shape helpers are a node-free subpath. */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isQueryFailure, type RenderRequest } from '@artifactbin/contracts';
import { browserClient, fakeBrowser, sqlClient } from '@artifactbin/utils';
import { inferColumns } from '@artifactbin/utils/shape';
import { serveSql } from '@artifactbin/sql';
import { createSql } from '@artifactbin/sql/local';
import { serveBrowser } from '@artifactbin/browser';

const sqlServer = serveSql(createSql({ maxRows: 3, timeoutMs: 2000 })); const sqlUrl = sqlServer.listen(0).url;
const browser = fakeBrowser({ ok: false, reason: 'no_slide', slides: 17 });
const browserServer = serveBrowser(browser); const browserUrl = browserServer.listen(0).url;
afterAll(async () => { await sqlServer.close(); await browserServer.close(); });

describe('clients in utils', () => {
  it('sqlClient round-trips against serveSql', async () => {
    const r = await sqlClient(sqlUrl, { deadlineMs: 5000 }).run({ tables: { t: { rows: [{ a: 1 }], columns: [{ name: 'a', type: 'number' }] } }, queries: [{ name: 'q', sql: 'select a from t' }], params: {} });
    expect(!isQueryFailure(r.q) && r.q.rows).toEqual([{ a: 1 }]);
  });
  it('browserClient serializes a render request and answers the service verdict', async () => {
    const request: RenderRequest = {
      url: 'https://example.test/a/abc123?key=sentinel',
      format: 'jpg',
      quality: 83,
      viewport: { width: 1200, height: 630 },
      selector: '#stage',
      capture: { slide: 4 },
      sameOriginOnly: true,
      injectCss: '.sentinel{display:none}',
      settleMs: 321,
      timeoutMs: 1234,
    };
    const r = await browserClient(browserUrl, { deadlineMs: 2000 }).render(request);
    expect(r).toEqual({ ok: false, reason: 'no_slide', slides: 17 });
    expect(browser.calls).toEqual([request]);
  });
  it('the shape subpath infers columns and imports no node module', () => {
    expect(inferColumns([{ a: 1, b: 'x' }])).toEqual([{ name: 'a', type: 'number' }, { name: 'b', type: 'string' }]);
    const src = fs.readFileSync(path.resolve(__dirname, '../src/shape.ts'), 'utf8');
    expect(src).not.toMatch(/from 'node:/);
  });
});
