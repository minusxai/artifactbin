/**
 * The online backend issues exactly the requests the surface's call sites
 * issued before the move — URL, method, headers (Idempotency-Key included),
 * credentials and body — and hands back what those call sites read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpBackend } from '../http';
import { BackendRequestError } from '../errors';

type Call = { url: string; init?: RequestInit };
function stubFetch(...responses: Array<Response | (() => Response) | Error>) {
  const calls: Call[] = [];
  const queue = [...responses];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next.clone();
  }));
  return calls;
}
const json = (body: unknown, status = 200) => Response.json(body, { status });
const bodyOf = (call: Call) => JSON.parse(String(call.init?.body));

afterEach(() => vi.unstubAllGlobals());

describe('createHttpBackend', () => {
  const backend = createHttpBackend('AbC123');

  it('is online and offers every feature', () => {
    expect(backend.mode).toBe('online');
    for (const feature of ['runQueries', 'webAssets', 'versions', 'mentions', 'commentImages', 'remoteSessions', 'live'] as const)
      expect(backend.unavailable(feature)).toBeNull();
  });

  it('loads the authoring head, null when refused, rejecting when unreachable', async () => {
    const calls = stubFetch(json({ id: 'AbC123', edit_id: 'e1', version: 3, markup: '<p/>' }));
    await expect(backend.load()).resolves.toMatchObject({ edit_id: 'e1', version: 3 });
    expect(calls).toEqual([{ url: '/api/my/artifacts/AbC123', init: undefined }]);
    stubFetch(json({ error: 'not_found' }, 404));
    await expect(backend.load()).resolves.toBeNull();
    stubFetch(new TypeError('Failed to fetch'));
    await expect(backend.load()).rejects.toThrow('Failed to fetch');
  });

  it('commits an edit batch and answers with status and body, {} when the body is not JSON', async () => {
    const calls = stubFetch(json({ edit_id: 'e2', version: 4, markup: 'x' }));
    const update = { schema: 1 } as never;
    await expect(backend.commitEdit({ edit_id: 'e1', document_update: update }))
      .resolves.toEqual({ ok: true, status: 200, body: { edit_id: 'e2', version: 4, markup: 'x' } });
    expect(calls[0]).toEqual({
      url: '/api/my/artifacts/AbC123/edits',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edit_id: 'e1', document_update: update }) },
    });
    stubFetch(() => new Response('<html>', { status: 502 }));
    await expect(backend.commitEdit({ edit_id: 'e1', document_update: update })).resolves.toEqual({ ok: false, status: 502, body: {} });
    stubFetch(json({ error: 'doc_changed', detail: 'identical' }, 409));
    await expect(backend.commitEdit({ edit_id: 'e1', document_update: update })).resolves.toMatchObject({ ok: false, status: 409, body: { detail: 'identical' } });
    stubFetch(new TypeError('offline'));
    await expect(backend.commitEdit({ edit_id: 'e1', document_update: update })).rejects.toThrow('offline');
  });

  it('prepares resources on the encoded /prepare door and rejects with the diagnostics', async () => {
    const calls = stubFetch(json({ warnings: [] }));
    await expect(backend.prepare('<p/>')).resolves.toEqual({ warnings: [] });
    expect(calls[0]).toEqual({
      url: '/api/my/artifacts/AbC123/prepare',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: '<p/>' }) },
    });
    stubFetch(json({ error: 'invalid', details: ['first', { message: 'second' }] }, 400));
    await expect(backend.prepare('<p/>')).rejects.toThrow('first\nsecond');
    stubFetch(json({}, 500));
    await expect(backend.prepare('<p/>')).rejects.toThrow('Unable to prepare document resources');
  });

  it('compiles draft CSS and runs draft queries', async () => {
    const calls = stubFetch(json({ css: '.a{}' }));
    await expect(backend.previewCss('<p/>')).resolves.toEqual({ css: '.a{}' });
    expect(calls[0]).toEqual({ url: '/api/preview', init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markup: '<p/>' }) } });
    stubFetch(json({ css: null }));
    await expect(backend.previewCss('<p/>')).rejects.toBeInstanceOf(BackendRequestError);
    stubFetch(json({}, 500));
    await expect(backend.previewCss('<p/>')).rejects.toBeInstanceOf(BackendRequestError);

    const q = stubFetch(json({ tables: { t: { rows: [] } }, errors: {} }));
    await expect(backend.previewQueries('<Query/>')).resolves.toEqual({ tables: { t: { rows: [] } }, errors: {} });
    expect(q[0]).toEqual({ url: '/api/query', init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markup: '<Query/>' }) } });
    stubFetch(json({}, 400));
    await expect(backend.previewQueries('<Query/>')).resolves.toBeNull();
  });

  it('reads a dataset table window, naming the refusal', async () => {
    const calls = stubFetch(json({ columns: [{ name: 'a' }], totalRows: 7 }));
    const body = { sql: 'select * from public.rows', limit: 1, offset: 0 };
    await expect(backend.queryTable('Ds 1', body)).resolves.toEqual({ columns: [{ name: 'a' }], totalRows: 7 });
    expect(calls[0]).toEqual({
      url: '/a/Ds%201/tables',
      init: { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    });
    stubFetch(json({ error: 'forbidden', details: ['no read access'] }, 403));
    await expect(backend.queryTable('Ds1', body)).rejects.toMatchObject({ message: 'no read access', status: 403 });
    stubFetch(json({ error: 'forbidden' }, 403));
    await expect(backend.queryTable('Ds1', body)).rejects.toThrow('forbidden');
  });

  it('imports a web image and uploads a file through the unlisted door, with each door\'s refusals', async () => {
    const calls = stubFetch(json({ id: 'Img123', rawUrl: '/a/Img123/raw' }));
    await expect(backend.importImage({ imageUrl: 'https://x.test/a.png' })).resolves.toEqual({ ok: true, image: { id: 'Img123', rawUrl: '/a/Img123/raw' } });
    expect(calls[0]).toEqual({
      url: '/api/my/artifacts?visibility=unlisted',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl: 'https://x.test/a.png' }) },
    });
    stubFetch(json({ error: 'blocked', details: ['https://x.test/a.png is not public'] }, 400));
    await expect(backend.importImage({ imageUrl: 'https://x.test/a.png' })).resolves.toEqual({ ok: false, error: 'https://x.test/a.png is not public' });
    stubFetch(json({}, 403));
    await expect(backend.importImage({ imageUrl: 'u' })).resolves.toEqual({ ok: false, error: 'You have reached your artifact limit.' });
    stubFetch(new TypeError('down'));
    await expect(backend.importImage({ imageUrl: 'u' })).resolves.toEqual({ ok: false, error: 'Import failed — check your connection and try again.' });

    const file = new Blob(['png'], { type: 'image/png' });
    const up = stubFetch(json({ id: 'Img456' }));
    await expect(backend.importImage({ file, name: 'a.png' })).resolves.toEqual({ ok: true, image: { id: 'Img456' } });
    expect(up[0]).toEqual({ url: '/api/my/artifacts?visibility=unlisted', init: { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: file } });
    stubFetch(json({}, 413));
    await expect(backend.importImage({ file, name: 'a.png' })).resolves.toEqual({ ok: false, error: 'That image is too large to upload.' });
    stubFetch(json({ error: 'invalid_image' }, 400));
    await expect(backend.importImage({ file, name: 'a.png' })).resolves.toEqual({ ok: false, error: 'That image type is not supported (png, jpeg, webp, gif, svg).' });
    stubFetch(new TypeError('down'));
    await expect(backend.importImage({ file, name: 'a.png' })).resolves.toEqual({ ok: false, error: 'Upload failed — check your connection and try again.' });
  });

  it('lists versions, reads one, and reverts on the conditional endpoint', async () => {
    const calls = stubFetch(json({ versions: [{ version: 2 }] }));
    await expect(backend.versions()).resolves.toEqual([{ version: 2 }]);
    expect(calls[0]).toEqual({ url: '/api/my/artifacts/AbC123/versions', init: undefined });
    stubFetch(json({}, 403));
    await expect(backend.versions()).resolves.toBeNull();
    const one = stubFetch(json({ version: 1, markup: '<p/>', meta: {} }));
    await expect(backend.version(1)).resolves.toMatchObject({ version: 1 });
    expect(one[0]).toEqual({ url: '/api/my/artifacts/AbC123/versions/1', init: undefined });
    stubFetch(json({}, 404));
    await expect(backend.version(1)).resolves.toBeNull();
    const revert = stubFetch(json({ version: 5 }));
    await expect(backend.revert({ version: 1, expectedVersion: 4, expectedState: 's' })).resolves.toEqual({ ok: true, status: 200, body: { version: 5 } });
    expect(revert[0]).toEqual({
      url: '/api/my/artifacts/AbC123/revert',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, expectedVersion: 4, expectedState: 's' }) },
    });
  });

  it('subscribes to the live stream, parses its frames and closes on unsubscribe', async () => {
    const sources: Array<{ url: string; onmessage: ((e: { data: string }) => void) | null; listeners: Record<string, (e: { data?: string }) => void>; closed: boolean }> = [];
    vi.stubGlobal('EventSource', class {
      url: string; onmessage: ((e: { data: string }) => void) | null = null; listeners: Record<string, (e: { data?: string }) => void> = {}; closed = false;
      constructor(url: string) { this.url = url; sources.push(this); }
      addEventListener(name: string, fn: (e: { data?: string }) => void) { this.listeners[name] = fn; }
      close() { this.closed = true; }
    });
    const onPing = vi.fn(), onData = vi.fn(), onAnnotations = vi.fn();
    const stop = backend.live({ onPing, onData, onAnnotations });
    const source = sources[0]!;
    expect(source.url).toBe('/a/AbC123/events');
    source.onmessage!({ data: 'not json' });
    source.onmessage!({ data: JSON.stringify({ editId: 'e9', version: 9, by: 'ada' }) });
    expect(onPing).toHaveBeenCalledTimes(1);
    expect(onPing).toHaveBeenCalledWith({ editId: 'e9', version: 9, by: 'ada' });
    source.listeners.data!({ data: '{' });
    source.listeners.data!({ data: JSON.stringify({ datasets: ['D1'], version: 2 }) });
    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith({ datasets: ['D1'], version: 2 });
    source.listeners.annotations!({});
    expect(onAnnotations).toHaveBeenCalledTimes(1);
    stop();
    expect(source.closed).toBe(true);

    const frame = stubFetch(json({ editId: 'e9', version: 9 }));
    await expect(backend.liveFrame()).resolves.toEqual({ editId: 'e9', version: 9 });
    expect(frame[0]).toEqual({ url: '/a/AbC123/events/frame', init: { credentials: 'same-origin' } });
    stubFetch(json({}, 403));
    await expect(backend.liveFrame()).resolves.toBeNull();
  });

  it('reads every annotation page for all, open or resolved threads', async () => {
    const calls = stubFetch(
      json({ annotations: [{ id: 'a1' }], next_cursor: 'c2' }),
      json({ annotations: [{ id: 'a2' }], next_cursor: null }),
    );
    const signal = new AbortController().signal;
    await expect(backend.listAnnotations(undefined, { signal })).resolves.toEqual([{ id: 'a1' }, { id: 'a2' }]);
    expect(calls.map((c) => c.url)).toEqual(['/api/my/artifacts/AbC123/annotations', '/api/my/artifacts/AbC123/annotations?cursor=c2']);
    expect(calls[0]!.init).toEqual({ credentials: 'same-origin', signal });
    const open = stubFetch(json({ annotations: [], next_cursor: null }));
    await backend.listAnnotations('open');
    await backend.listAnnotations('resolved');
    expect(open.map((c) => c.url)).toEqual(['/api/my/artifacts/AbC123/annotations?status=open', '/api/my/artifacts/AbC123/annotations?status=resolved']);
    stubFetch(json({}, 500));
    await expect(backend.listAnnotations()).rejects.toThrow('Annotation read failed (HTTP 500)');
  });

  it('creates an annotation with its Idempotency-Key and names refusals', async () => {
    const calls = stubFetch(json({ id: 'ann_1', status: 'open' }, 201));
    const body = { path: '0', node_id: 'n1', body: 'hi' };
    await expect(backend.createAnnotation(body, 'key-1')).resolves.toEqual({ id: 'ann_1', status: 'open' });
    expect(calls[0]).toEqual({
      url: '/api/my/artifacts/AbC123/annotations',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'key-1' }, body: JSON.stringify(body) },
    });
    stubFetch(json({ error: 'sign_in_required' }, 401));
    await expect(backend.createAnnotation(body, 'k')).rejects.toMatchObject({ signInRequired: true, status: 401 });
    stubFetch(json({ code: 'sign_in_required' }, 403));
    await expect(backend.createAnnotation(body, 'k')).rejects.toMatchObject({ signInRequired: true });
    stubFetch(json({ error: 'invalid_anchor', details: [{ message: 'node moved' }] }, 400));
    await expect(backend.createAnnotation(body, 'k')).rejects.toMatchObject({ message: 'invalid_anchor: node moved', signInRequired: false });
    stubFetch(json({ error: 'stale', detail: 'retake' }, 409));
    await expect(backend.createAnnotation(body, 'k')).rejects.toThrow('stale: retake');
    stubFetch(() => new Response('oops', { status: 500 }));
    await expect(backend.createAnnotation(body, 'k')).rejects.toThrow('Could not save comment (500)');
  });

  it('acts on and deletes an annotation', async () => {
    const calls = stubFetch(json({ id: 'ann_1', status: 'resolved' }));
    await expect(backend.actOnAnnotation('ann_1', { resolve: true })).resolves.toEqual({ id: 'ann_1', status: 'resolved' });
    expect(calls[0]).toEqual({
      url: '/api/my/artifacts/AbC123/annotations/ann_1',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolve: true }) },
    });
    stubFetch(json({}, 403));
    await expect(backend.actOnAnnotation('ann_1', { reply: 'x' })).rejects.toBeInstanceOf(BackendRequestError);
    const del = stubFetch(new Response(null, { status: 204 }));
    await expect(backend.deleteAnnotation('ann_1')).resolves.toBeUndefined();
    expect(del[0]).toEqual({ url: '/api/my/artifacts/AbC123/annotations/ann_1', init: { method: 'DELETE' } });
    stubFetch(json({}, 403));
    await expect(backend.deleteAnnotation('ann_1')).rejects.toThrow('Could not delete this comment. Try again.');
  });

  it('uploads a comment image as the form it was given', async () => {
    const form = new FormData();
    form.set('metadata', '{}');
    const calls = stubFetch(json({ id: 'img_1' }, 201));
    await expect(backend.uploadCommentImage(form)).resolves.toEqual({ id: 'img_1' });
    expect(calls[0]).toEqual({ url: '/api/my/artifacts/AbC123/comment-images', init: { method: 'POST', body: form } });
    stubFetch(json({ error: 'stale' }, 409));
    await expect(backend.uploadCommentImage(form)).rejects.toThrow('The document changed. Your draft is preserved; retake the screenshot.');
    stubFetch(json({ error: 'quota_exceeded' }, 413));
    await expect(backend.uploadCommentImage(form)).rejects.toThrow('Image storage quota reached.');
    stubFetch(json({ error: 'other' }, 400));
    await expect(backend.uploadCommentImage(form)).rejects.toThrow('Could not upload the screenshot. Please retry.');
  });

  it('reads members: statuses without a query, people for any query string', async () => {
    const signal = new AbortController().signal;
    const calls = stubFetch(json({ mentions: { u1: 'pending' } }));
    await expect(backend.members(undefined, { signal })).resolves.toEqual({ mentions: { u1: 'pending' } });
    await backend.members('');
    await backend.members('a b');
    expect(calls.map((c) => c.url)).toEqual([
      '/api/my/artifacts/AbC123/members',
      '/api/my/artifacts/AbC123/members?query=',
      '/api/my/artifacts/AbC123/members?query=a%20b',
    ]);
    expect(calls[0]!.init).toEqual({ signal });
    stubFetch(json({}, 401));
    await expect(backend.members('x')).resolves.toBeNull();
  });

  it('lists and removes agent sessions', async () => {
    const signal = new AbortController().signal;
    const calls = stubFetch(json({ sessions: [{ id: 's1' }] }));
    await expect(backend.remoteSessions({ signal })).resolves.toEqual({ sessions: [{ id: 's1' }] });
    expect(calls[0]).toEqual({ url: '/api/remote/sessions', init: { credentials: 'same-origin', signal } });
    stubFetch(json({}, 401));
    await expect(backend.remoteSessions()).resolves.toEqual({ sessions: [] });
    const del = stubFetch(new Response(null, { status: 204 }));
    await backend.deleteRemoteSession('s1');
    expect(del[0]).toEqual({ url: '/api/remote/sessions/s1', init: { method: 'DELETE', credentials: 'same-origin' } });
    stubFetch(json({ error: 'not yours' }, 403));
    await expect(backend.deleteRemoteSession('s1')).rejects.toThrow('not yours');
    stubFetch(() => new Response('x', { status: 500 }));
    await expect(backend.deleteRemoteSession('s1')).rejects.toThrow('Could not remove agent. Try again.');
  });

  it('hands the runtime the authenticated transport', async () => {
    const calls = stubFetch(json({ tables: {}, errors: {} }));
    const transport = backend.queryTransport();
    await transport.run({}, ['q']);
    expect(calls[0]!.url).toBe('/a/AbC123/query');
    expect(calls[0]!.init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    transport.dispose();
  });
});
