import type { IncomingMessage } from 'node:http';
import { withHttpServer, type RunningServer } from '@artifactbin/test-support/net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createNativeS3ObjectSink } from '..';

/** A minimal S3 stand-in: path-style PUT honouring `If-None-Match: *` and GET, recording every request. */
const objects = new Map<string, { bytes: Buffer; type: string | undefined }>();
const seen: Array<{ method: string; url: string; ifNoneMatch?: string }> = [];
let server: RunningServer, endpoint = '';
const body = async (request: IncomingMessage) => { const parts: Buffer[] = []; for await (const part of request) parts.push(part as Buffer); return Buffer.concat(parts); };
beforeAll(async () => {
  server = await withHttpServer(async (request, response) => {
    const url = decodeURIComponent(request.url!.split('?')[0]!);
    seen.push({ method: request.method!, url, ifNoneMatch: request.headers['if-none-match'] as string | undefined });
    if (request.method === 'PUT') {
      const bytes = await body(request);
      if (request.headers['if-none-match'] === '*' && objects.has(url)) { response.writeHead(412, { 'content-type': 'application/xml' }).end('<Error><Code>PreconditionFailed</Code></Error>'); return; }
      objects.set(url, { bytes, type: request.headers['content-type'] });
      response.writeHead(200, { etag: '"etag"' }).end();
      return;
    }
    const found = objects.get(url);
    if (!found) { response.writeHead(404, { 'content-type': 'application/xml' }).end('<Error><Code>NoSuchKey</Code></Error>'); return; }
    response.writeHead(200, { 'content-length': found.bytes.length }).end(found.bytes);
  });
  endpoint = server.base;
});
afterAll(() => server.close());
beforeEach(() => { objects.clear(); seen.length = 0; });
const sink = (prefix = 'native/imports') => createNativeS3ObjectSink({ bucket: 'bucket', region: 'us-east-1', accessKeyId: 'test-key', secretAccessKey: 'test-secret', endpoint, forcePathStyle: true, prefix });

describe('createNativeS3ObjectSink', () => {
  it('writes once under the configured prefix with a create-only condition, and reads the bytes back', async () => {
    const store = sink();
    expect(await store.putIfAbsent('catalog/a.json', Buffer.from('{"ü":1}'), 'application/json')).toBe('created');
    expect(seen[0]).toMatchObject({ method: 'PUT', url: '/bucket/native/imports/catalog/a.json', ifNoneMatch: '*' });
    expect(objects.get('/bucket/native/imports/catalog/a.json')?.type).toBe('application/json');
    expect((await store.get('catalog/a.json')).toString()).toBe('{"ü":1}');
  });

  it('answers exists for a key already written and never overwrites it', async () => {
    const store = sink('');
    await store.putIfAbsent('k', Buffer.from('first'));
    expect(await store.putIfAbsent('k', Buffer.from('second'))).toBe('exists');
    expect((await store.get('k')).toString()).toBe('first');
    expect(seen[0]!.url).toBe('/bucket/k');
  });

  it('refuses malformed keys before any request', async () => {
    const store = sink();
    for (const key of ['', '../escape', 'a//b', 'a/./b', 'sp ace', 'ünicode', '/abs'])
      await expect(store.putIfAbsent(key, Buffer.from('x'))).rejects.toThrow('native_catalog_object_key');
    await expect(store.get('a/../b')).rejects.toThrow('native_catalog_object_key');
    expect(seen).toEqual([]);
  });

  it('surfaces a missing object and any other store failure as an error', async () => {
    await expect(sink().get('missing')).rejects.toThrow();
  });
});
