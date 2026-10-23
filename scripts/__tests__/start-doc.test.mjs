import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { request } from 'playwright';
import { verifiedAccountSession, readDocumentHead } from '../lib/start-doc.mjs';
import { isSignedInAs } from '../lib/mail-login.mjs';

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

const accountEmail = 'mxmx_test_session@example.test';
const accountPage = (client, base) => ({request: client, url: () => `${base}/`});
it('identity verification recovers one reset and still checks the exact account', async () => {
  await withSessionServer((req, res, calls) => {
    if (calls === 1) return req.socket.destroy();
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({kind: 'account', user: {email: accountEmail}}));
  }, async (client, base, calls) => {
    await expect(isSignedInAs(accountPage(client, base), accountEmail)).resolves.toBe(true);
    expect(calls()).toBe(2);
  });
});
it('identity verification fails after a second reset', async () => {
  await withSessionServer(req => req.socket.destroy(), async (client, base, calls) => {
    await expect(isSignedInAs(accountPage(client, base), accountEmail)).rejects.toThrow(/ECONNRESET|socket hang up/);
    expect(calls()).toBe(2);
  });
});
it.each([[503, 'account', accountEmail], [200, 'anon', accountEmail], [200, 'account', 'different@example.test']])('identity verification refuses HTTP or identity failures without replay (%i, %s, %s)', async (status, kind, email) => {
  await withSessionServer((_req, res) => {
    res.writeHead(status, {'content-type': 'application/json'});
    res.end(JSON.stringify({kind, user: {email}}));
  }, async (client, base, calls) => {
    await expect(isSignedInAs(accountPage(client, base), accountEmail)).resolves.toBe(false);
    expect(calls()).toBe(1);
  });
});

it('reads native publication guards with the API credential only in the HTTP header', async () => {
  let received;
  const head = await readDocumentHead('https://example.test', 'page12', 'api-credential', async (url, init) => {
    received = {url, init}; return Response.json({format: 'html', version: 4, state: 'observed', source: '<html></html>'});
  });
  expect(head.version).toBe(4); expect(head.state).toBe('observed');
  expect(received.url).toBe('https://example.test/api/artifacts/page12');
  expect(received.init.headers.Authorization).toBe('Bearer api-credential');
  expect(received.init.redirect).toBe('error');
});
it.each([Response.json({error:'not_found'},{status:404}), Response.json({format:'markup',version:1,state:'old'})])('refuses unavailable or retired fixture heads', async response => {
  await expect(readDocumentHead('https://example.test','page12','credential',async()=>response)).rejects.toThrow(/cannot read|native HTML/);
});
