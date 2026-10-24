import { expect, it, vi } from 'vitest';
import { inspectLocalPublication, localPublicationRequest, sendLocalPublication } from '../transport';
import { publicationBody } from '../selection';
const body = () => publicationBody({ entryPath: 'page.html', html: '<p>Chosen local source</p>', files: [] });
it('preflights without hitting artifact creation and surfaces missing dependency paths', async () => {
  const send = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ error: 'unresolved_publication_dependencies', details: ['Unresolved local dependencies: image.png'] }), { status: 400 }));
  await expect(inspectLocalPublication(body(), send)).rejects.toThrow('image.png');
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[0]).toBe('/api/my/local-publications/plan');
});
it('retries the identical frozen snapshot and key, then hashes normalized saved source', async () => {
  const input = body(), request = localPublicationRequest(input, 'publication_retry_001');
  input.html = '<p>Changed after review</p>';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let failed = false;
  const send = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (!failed) { failed = true; throw new Error('Connection lost'); }
    return String(url) === '/api/my/artifacts' ? new Response(JSON.stringify({ id: 'AbC123', dependencyReceipts: [{ path: 'image.png', id: 'File01' }] }), { status: 201 }) : new Response(JSON.stringify({ html: '<p data-af-id="node1">Saved</p>', version: 1 }));
  });
  await expect(sendLocalPublication(request, 'https://example.test', send)).rejects.toThrow('Connection lost');
  const saved = await sendLocalPublication(request, 'https://example.test', send);
  expect(calls[0]).toEqual(calls[1]);
  expect(JSON.parse(String(calls[0]?.init?.body)).html).toBe('<p>Chosen local source</p>');
  expect(calls[0]?.init?.headers).toMatchObject({ 'Idempotency-Key': 'publication_retry_001' });
  expect(saved).toMatchObject({ source: '<p data-af-id="node1">Saved</p>', identity: { artifactId: 'AbC123', platformOrigin: 'https://example.test', baseRevision: '1', sourceDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }, dependencyIdentity: { 'image.png': 'File01' } });
});
it('keeps the creation key recoverable when reading back committed source fails', async () => {
  const request = localPublicationRequest(body(), 'readback_retry_001');
  const send = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url) === '/api/my/artifacts' ? { id: 'AbC123' } : { error: 'unavailable' }), { status: String(url) === '/api/my/artifacts' ? 201 : 503 }));
  await expect(sendLocalPublication(request, 'https://example.test', send)).rejects.toThrow();
  expect(request.key).toBe('readback_retry_001');
});
