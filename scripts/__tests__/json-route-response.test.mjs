import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { request } from 'playwright';
import { jsonRouteResponse } from '../gates/lib/json-route-response.mjs';

it('reads JSON and delivers the same HTTP response with its status and cookie headers', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(201, {
      'content-type': 'application/json',
      'set-cookie': 'guest=owner; HttpOnly; SameSite=Lax',
    });
    res.end(JSON.stringify({ id: 'abc123' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = await request.newContext();
  const events = [];
  try {
    const url = `http://127.0.0.1:${server.address().port}/start`;
    const response = await client.get(url);
    const result = await jsonRouteResponse({
      fetch: async () => { events.push('fetch'); return response; },
      fulfill: async options => {
        expect(options).toEqual({ response });
        expect(options.response.status()).toBe(201);
        expect(options.response.headers()['set-cookie']).toMatch(/HttpOnly/);
        events.push('deliver');
      },
      abort: async () => { throw Error('must not abort success'); },
    });

    expect(result).toEqual({ response, body: { id: 'abc123' } });
    expect(events).toEqual(['fetch', 'deliver']);
  } finally {
    await client.dispose();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

it('reports a failed fetch and aborts its browser request without replaying the mutation', async () => {
  const error = Error('read ECONNRESET');
  let calls = 0;
  let aborts = 0;
  const outcome = await jsonRouteResponse({
    fetch: async () => { calls++; throw error; },
    fulfill: async () => { throw Error('must not deliver a failed request'); },
    abort: async () => { aborts++; },
  });

  expect(outcome.error).toBe(error);
  expect(calls).toBe(1);
  expect(aborts).toBe(1);
});
