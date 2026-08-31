/**
 * The recording proxy: every request the agent makes to the leg's server is
 * appended to a JSONL ledger with its status, and the `error` code of a JSON
 * failure body — so a run's ledger says "PUT 400 invalid_jsx", not just "400".
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DRIVER_HEADER, startProxy, transportFor } from '../lib/proxy';
import { parseLedger } from '../lib/ledger';

let target: http.Server;
let targetPort: number;
let proxy: Awaited<ReturnType<typeof startProxy>>;
let ledgerPath: string;

beforeAll(async () => {
  target = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/api/artifacts' && req.method === 'POST') { res.writeHead(201, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'madeUp', markup: '<h1>x</h1>' })); return; }
      if (req.url === '/mcp' && req.method === 'POST') {
        const call = JSON.parse(body) as { id?: unknown; params?: { arguments?: { markup?: string } } };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0', id: call.id,
          result: { content: [{ type: 'text', text: JSON.stringify({ id: 'mcpMade', markup: call.params?.arguments?.markup }) }] },
        }));
        return;
      }
      if (req.url === '/api/artifacts/pathId/edits') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'pathId' })); return; }
      if (req.url === '/bad') { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_jsx', details: [] })); return; }
      if (req.url === '/echo' && req.method === 'PUT') {
        const { markup } = JSON.parse(body);
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'x', markup: markup.replace('<p><div>', '<div>').replace('</div></p>', '</div>') })); return;
      }
      if (req.url === '/echo?unchanged=1' && req.method === 'PUT') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'x', markup_changed: false })); return; }
      if (req.url === '/stream') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: 1\n\n'); setTimeout(() => res.end('data: 2\n\n'), 30); return; }
      res.writeHead(200, { 'content-type': 'text/plain', 'x-echo-ua': req.headers['user-agent'] ?? '', 'x-echo-host': req.headers.host ?? '' }); res.end('ok ' + req.method + ' ' + req.url);
    });
  });
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
  targetPort = (target.address() as { port: number }).port;
  ledgerPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eval-proxy-')), 'ledger.jsonl');
  proxy = await startProxy({ port: 0, target: `http://127.0.0.1:${targetPort}`, ledgerPath });
});
afterAll(async () => { await proxy.stop(); await new Promise<void>((r) => target.close(() => r())); });

describe('startProxy', () => {
  it('forwards method, path, headers, and body; records status, UA and bearer presence', async () => {
    const res = await fetch(`${proxy.url}/docs/llm?x=1`, { headers: { 'user-agent': 'agent/1', authorization: 'Bearer mx_abc' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok GET /docs/llm?x=1');
    // The Host the agent addressed (the proxy) reaches the product unchanged — it is what the start link is built from.
    expect(res.headers.get('x-echo-host')).toBe(new URL(proxy.url).host);
    const entries = parseLedger(fs.readFileSync(ledgerPath, 'utf8'));
    expect(entries.at(-1)).toMatchObject({ method: 'GET', path: '/docs/llm?x=1', status: 200, ua: 'agent/1', auth: 'bearer', error: null });
    expect(entries.at(-1)!.ms).toBeGreaterThanOrEqual(0);
  });

  it('captures the error code of a JSON failure body without altering the response', async () => {
    const res = await fetch(`${proxy.url}/bad`, { method: 'PUT', body: '{}' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_jsx', details: [] });
    const entries = parseLedger(fs.readFileSync(ledgerPath, 'utf8'));
    expect(entries.at(-1)).toMatchObject({ status: 400, error: 'invalid_jsx', auth: null });
  });

  it('keeps the markup sent and the markup echoed on a JSON document write', async () => {
    const res = await fetch(`${proxy.url}/echo`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ markup: '<p><div>x</div></p>' }) });
    expect((await res.json()).markup).toBe('<div>x</div>');
    const entries = parseLedger(fs.readFileSync(ledgerPath, 'utf8'));
    expect(entries.at(-1)).toMatchObject({ reqMarkup: '<p><div>x</div></p>', resMarkup: '<div>x</div>' });
  });

  it('streams a chunked response through and logs it when it ends', async () => {
    const res = await fetch(`${proxy.url}/stream`);
    expect(await res.text()).toBe('data: 1\n\ndata: 2\n\n');
    const entries = parseLedger(fs.readFileSync(ledgerPath, 'utf8'));
    expect(entries.at(-1)).toMatchObject({ path: '/stream', status: 200 });
  });

  it('answers 502 with a ledger entry when the target is down', async () => {
    const dead = await startProxy({ port: 0, target: 'http://127.0.0.1:1', ledgerPath });
    const res = await fetch(`${dead.url}/x`);
    expect(res.status).toBe(502);
    await dead.stop();
    const entries = parseLedger(fs.readFileSync(ledgerPath, 'utf8'));
    expect(entries.at(-1)).toMatchObject({ path: '/x', status: 502 });
  });
});

describe('ledger file', () => {
  it('exists as soon as the proxy is up, so a run with zero agent requests reads as an empty ledger', async () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eval-proxy-')), 'ledger.jsonl');
    const fresh = await startProxy({ port: 0, target: 'http://127.0.0.1:1', ledgerPath: p });
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p, 'utf8')).toBe('');
    await fresh.stop();
  });
});

describe('artifact id capture', () => {
  it('reads the id from a create response body and from a write path', async () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eval-proxy-')), 'ledger.jsonl');
    const px = await startProxy({ port: 0, target: `http://127.0.0.1:${targetPort}`, ledgerPath: p });
    await fetch(`${px.url}/api/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ markup: '<h1>x</h1>' }) });
    await fetch(`${px.url}/api/artifacts/pathId/edits`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    await px.stop();
    const entries = parseLedger(fs.readFileSync(p, 'utf8'));
    expect(entries[0].artifactId).toBe('madeUp');       // from the response body
    expect(entries[1].artifactId).toBe('pathId');       // from the URL
  });

  it('unwraps MCP tool arguments before recording the content tier and markup', async () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eval-proxy-')), 'ledger.jsonl');
    const px = await startProxy({ port: 0, target: `http://127.0.0.1:${targetPort}`, ledgerPath: p });
    await fetch(`${px.url}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'create_artifact', arguments: { dataset: [{ month: 'Jan', value: 4 }] } },
      }),
    });
    await fetch(`${px.url}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'update_artifact', arguments: { id: 'mcpMade', markup: '<h1>From MCP</h1>' } },
      }),
    });
    await px.stop();
    const entries = parseLedger(fs.readFileSync(p, 'utf8'));
    expect(entries[0]).toMatchObject({ artifactId: 'mcpMade', reqFormat: 'dataset' });
    expect(entries[1]).toMatchObject({
      artifactId: 'mcpMade', reqFormat: 'markup',
      reqMarkup: '<h1>From MCP</h1>', resMarkup: '<h1>From MCP</h1>',
    });
  });
});

describe('pointing at a deployment', () => {
  it('presents the TARGET\'s host when asked, instead of the one the agent addressed', async () => {
    // A real deployment 307s to a login page if it sees a foreign Host (NextAuth derives URLs from it).
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eval-proxy-')), 'ledger.jsonl');
    const px = await startProxy({ port: 0, target: `http://127.0.0.1:${targetPort}`, ledgerPath: p, rewriteHost: true });
    const res = await fetch(`${px.url}/docs/llm`);
    expect(res.headers.get('x-echo-host')).toBe(`127.0.0.1:${targetPort}`);
    await px.stop();
  });

  it('keeps the agent\'s host by default — a local server must mint links back to the proxy', async () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eval-proxy-')), 'ledger.jsonl');
    const px = await startProxy({ port: 0, target: `http://127.0.0.1:${targetPort}`, ledgerPath: p });
    const res = await fetch(`${px.url}/docs/llm`);
    expect(res.headers.get('x-echo-host')).toBe(new URL(px.url).host);
    await px.stop();
  });

  it('speaks https to an https target', async () => {
    const https = await import('node:https');
    const http = await import('node:http');
    expect(transportFor('https://artifactbin.dev')).toBe(https.default);
    expect(transportFor('http://127.0.0.1:3100')).toBe(http.default);
  });
});

describe('the driver\'s own setup traffic', () => {
  /**
   * A task's ledger must contain EXACTLY the agent's traffic — that is what
   * replaced slicing one shared ledger by wall clock, and it is what lets a
   * leg's tasks run at the same time. The driver mints the start document
   * through this same proxy, so it marks its own calls and they are forwarded
   * but never recorded.
   */
  it('is forwarded but never recorded', async () => {
    const before = parseLedger(fs.readFileSync(ledgerPath, 'utf8')).length;
    const res = await fetch(`${proxy.url}/api/start`, { method: 'POST', headers: { [DRIVER_HEADER]: '1', 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(200);
    expect(parseLedger(fs.readFileSync(ledgerPath, 'utf8')).length).toBe(before);
  });

  it('the same request WITHOUT the mark is recorded, so the mark is what decides', async () => {
    const before = parseLedger(fs.readFileSync(ledgerPath, 'utf8')).length;
    await fetch(`${proxy.url}/api/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const after = parseLedger(fs.readFileSync(ledgerPath, 'utf8'));
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)!.path).toBe('/api/start');
  });
});

describe('response bytes', () => {
  it('stamps the response body size on every entry', async () => {
    const p = path.join(path.dirname(ledgerPath), 'bytes.jsonl');
    const px = await startProxy({ port: 0, target: `http://127.0.0.1:${targetPort}`, ledgerPath: p });
    await fetch(`${px.url}/docs/llm`);
    await px.stop();
    const entry = JSON.parse(fs.readFileSync(p, 'utf8').trim().split('\n')[0]) as { bytes?: number; path: string };
    expect(entry.path).toBe('/docs/llm');
    expect(entry.bytes).toBeGreaterThan(0);
  });
});

describe('the conditional echo', () => {
  it('records markup_changed so an unchanged document still scores canonical_stable', async () => {
    const p = path.join(path.dirname(ledgerPath), 'unchanged.jsonl');
    const px = await startProxy({ port: 0, target: `http://127.0.0.1:${targetPort}`, ledgerPath: p });
    await fetch(`${px.url}/echo?unchanged=1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ markup: '<div>same</div>' }),
    });
    await px.stop();
    const entry = parseLedger(fs.readFileSync(p, 'utf8'))[0];
    expect(entry.markupUnchanged).toBe(true);
    expect(entry.reqMarkup).toBe('<div>same</div>');
  });
});
