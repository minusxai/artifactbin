import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { api, ApiError } from '../src/client';

test('plain-text proxy errors report the HTTP failure instead of a JSON parser error', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    await assert.rejects(api({ server: `http://127.0.0.1:${address.port}`, token: 'test' }, ''), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 500);
      assert.match(error.message, /HTTP 500.*Check the server logs/);
      return true;
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
