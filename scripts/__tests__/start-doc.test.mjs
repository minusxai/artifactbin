import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { request } from 'playwright';
import { verifiedAccountSession } from '../lib/start-doc.mjs';

async function withSessionServer(handler, verify) {
  let calls = 0;
  const server = createServer((req, res) => handler(req, res, ++calls));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = await request.newContext();
  try {
    await verify(client, `http://127.0.0.1:${server.address().port}`, () => calls);
  } finally {
    await client.dispose();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

it('recovers one reset while still requiring the verified account response', async () => {
  await withSessionServer((req, res, calls) => {
    if (calls === 1) return req.socket.destroy();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ kind: 'account' }));
  }, async (client, base, calls) => {
    await expect(verifiedAccountSession(client, base)).resolves.toBe(200);
    expect(calls()).toBe(2);
  });
});

it('fails after a second reset instead of hiding an unavailable server', async () => {
  await withSessionServer(req => req.socket.destroy(), async (client, base, calls) => {
    await expect(verifiedAccountSession(client, base)).rejects.toThrow(/ECONNRESET|socket hang up/);
    expect(calls()).toBe(2);
  });
});

it.each([[503, 'account'], [200, 'anon']])('does not replay an HTTP response or accept invalid authority (%i, %s)', async (status, kind) => {
  await withSessionServer((_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ kind }));
  }, async (client, base, calls) => {
    await expect(verifiedAccountSession(client, base)).rejects.toThrow('guest merge requires a verified account');
    expect(calls()).toBe(1);
  });
});
