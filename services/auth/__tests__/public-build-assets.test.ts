import { ANONYMOUS } from '@artifactbin/contracts/actor';
import { BUILD_ASSET_HEADER, BUILD_ASSET_PATH } from '@artifactbin/contracts/build-assets';
import type { Upstream } from '@artifactbin/contracts/part';
import { publicBuildAssets } from '@artifactbin/auth/parts';
import { assemble } from '@artifactbin/utils/assemble';
import { expect, it, vi } from 'vitest';

const path = '/af/app/entry-123.js';
const source = 'https://example.test' + path;
const assetHeaders = { [BUILD_ASSET_HEADER]: '1', 'content-type': 'text/javascript' };

function appWith(upstream: Upstream, deadlineMs?: number) {
  return assemble([
    publicBuildAssets({ upstream, deadlineMs }),
    { name: 'normal', mount: app => app.all('*', c => c.text('normal: ' + c.req.header('cookie'))) },
  ]);
}

it('asks for build bytes anonymously and retains only verified public headers', async () => {
  const upstream = vi.fn<Upstream>(async () => new Response('script', { headers: { ...assetHeaders, 'set-cookie': 'test=1', etag: '"etag"' } }));
  const app = appWith(upstream);
  const response = await app.request(source, {
    headers: { cookie: 'test=1', authorization: 'Bearer fixture', 'x-forwarded-host': 'other.test', 'if-none-match': '"old"' },
  });
  const [[probe, actor]] = upstream.mock.calls;
  expect(actor).toBe(ANONYMOUS);
  expect(new URL(probe.url).pathname).toBe(BUILD_ASSET_PATH + path);
  expect(Object.fromEntries(probe.headers)).toEqual({ 'if-none-match': '"old"' });
  expect(Object.fromEntries(response.headers)).toEqual({
    'cache-control': 'public, max-age=31536000, immutable', 'content-type': 'text/javascript',
    etag: '"etag"', 'x-content-type-options': 'nosniff',
  });
  expect(await response.text()).toBe('script');
  for (const [url, method] of [[source + '?v=1', 'GET'], [source, 'POST'], ['https://example.test/api/normal', 'GET']])
    expect(await (await app.request(url, { method })).text()).toBe('normal: undefined');
  expect(upstream).toHaveBeenCalledTimes(1);
});

it.each(['unavailable', 'unverified'] as const)('falls through with the original request after an %s probe', async kind => {
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const upstream: Upstream = async () => {
    if (kind === 'unavailable') throw new Error('upstream unavailable');
    const body = new ReadableStream<Uint8Array>({ cancel });
    return new Response(body, { headers: { 'content-type': 'text/javascript' } });
  };
  expect(await (await appWith(upstream).request(source, { headers: { cookie: 'test=1' } })).text()).toBe('normal: test=1');
  if (kind === 'unverified') expect(cancel).toHaveBeenCalledOnce();
});

it('passes the caller abort to the probe with a deadline configured', async () => {
  const caller = new AbortController();
  const gone = new Error('caller gone');
  const seen = vi.fn();
  const upstream: Upstream = async request => {
    return new Promise<Response>((_resolve, reject) => request.signal.addEventListener('abort', () => {
      seen(request.signal.reason);
      reject(request.signal.reason);
    }, { once: true }));
  };
  const response = appWith(upstream, 10_000).request(source, { signal: caller.signal });
  caller.abort(gone);
  expect(await (await response).text()).toBe('normal: undefined');
  expect(seen).toHaveBeenCalledWith(gone);
});

it('aborts a stalled response head at the deadline and falls through', async () => {
  vi.useFakeTimers();
  try {
    const seen = vi.fn();
    const upstream: Upstream = async request => new Promise<Response>((_resolve, reject) => {
      request.signal.addEventListener('abort', () => { seen(); reject(request.signal.reason); }, { once: true });
    });
    const response = appWith(upstream, 50).request(source);
    await vi.advanceTimersByTimeAsync(49);
    expect(seen).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toHaveBeenCalledOnce();
    expect(await (await response).text()).toBe('normal: undefined');
  } finally { vi.useRealTimers(); }
});

it('clears the deadline at a verified head and retains the signal for the streaming body', async () => {
  vi.useFakeTimers();
  try {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
    const upstream = vi.fn<Upstream>(async () => new Response(body, { headers: assetHeaders }));
    const caller = new AbortController();
    const response = await appWith(upstream, 50).request(source, { signal: caller.signal });
    const [[probe]] = upstream.mock.calls;
    await vi.advanceTimersByTimeAsync(100);
    expect(probe.signal.aborted).toBe(false);
    stream.enqueue(new TextEncoder().encode('still streaming'));
    expect(new TextDecoder().decode((await response.body!.getReader().read()).value)).toBe('still streaming');
    caller.abort();
    expect(probe.signal.aborted).toBe(true);
    stream.close();
  } finally { vi.useRealTimers(); }
});
