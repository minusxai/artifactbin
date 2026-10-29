/** One line per request: method, path WITHOUT the query string, status, duration. Never headers, bodies or queries. */
import { afterEach, describe, expect, it } from 'vitest';
import { withHttpServer, type RunningServer } from '@artifactbin/test-support/net';
import { requestPath, withRequestLog } from '../request-log';

let server: RunningServer | null = null;
afterEach(async () => { await server?.close(); server = null; });

const serve = async (lines: Array<Record<string, unknown>>) => {
  server = await withHttpServer(withRequestLog((req, res) => { res.statusCode = req.url?.startsWith('/missing') ? 404 : 201; res.end('ok'); }, (fields) => lines.push(fields)));
  return server.base;
};
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('request log', () => {
  it('records method, path, status and duration, and nothing from the query string, headers or body', async () => {
    const lines: Array<Record<string, unknown>> = [];
    const base = await serve(lines);
    await fetch(`${base}/api/artifacts/abc?token=mxmx_secret&code=123#frag`, { method: 'POST', headers: { authorization: 'Bearer mxmx_secret', cookie: 'a=b' }, body: 'secret-body' });
    await fetch(`${base}/missing`);
    await settled();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ method: 'POST', path: '/api/artifacts/abc', status: 201 });
    expect(typeof lines[0]!.ms).toBe('number');
    expect(lines[1]).toMatchObject({ method: 'GET', path: '/missing', status: 404 });
    expect(JSON.stringify(lines)).not.toMatch(/mxmx_secret|123|secret-body|cookie|authorization|frag/i);
  });
  it('skips the health probes', async () => {
    const lines: Array<Record<string, unknown>> = [];
    const base = await serve(lines);
    await fetch(`${base}/health`);
    await fetch(`${base}/api/health?x=1`);
    await settled();
    expect(lines).toEqual([]);
  });
  it('cuts the path at the first ? or #', () => {
    expect(requestPath('/a/b?c=d')).toBe('/a/b');
    expect(requestPath('/a#x')).toBe('/a');
    expect(requestPath(undefined)).toBe('/');
  });
});
