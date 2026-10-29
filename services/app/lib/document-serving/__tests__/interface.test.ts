/**
 * lib/document-serving's interface: the app page's frame markup and head, the raw document door's refusals
 * (malformed, unknown, deleted, private to a stranger, another document's origin), the runtime stylesheet request,
 * the native runtime's public code doors, a document's title, component modules, and which shells may be cached.
 */
import { describe, expect, it } from 'vitest';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';
import { POST } from '@/app/api/artifacts/route';
import { markPagesRequest, pagesSite } from '@/lib/http';
import { getDb } from '@/lib/platform';
import {
  DOCUMENT_FRAME_CSS, cachedShell, componentModuleResponse, documentFrameFallback, documentFrameHtml, documentHeadTags, nativeHtmlApolloResponse,
  nativeHtmlCoreResponse, nativeHtmlModuleResponse, nativeHtmlReaderResponse, nativeHtmlTitle, parseRuntimeCssRequest, runtimeCssAnswer, serveRawDocument,
} from '@/lib/document-serving';
import { FRAME_ALLOW, FRAME_SANDBOX } from '@/lib/document-serving/document-frame';

useAppHarness();

const html = (title: string) => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`;
async function publish(visibility: 'public' | 'private') {
  const owner = await mintAccountToken('serving');
  const response = await POST(request('/api/artifacts', { method: 'POST', token: owner.token, json: { html: html('Served'), visibility } }));
  expect(response.status).toBe(201);
  return { owner, id: (await response.json()).id as string };
}

describe('the frame', () => {
  const frame = { src: 'https://x.pages.example/?_pt="t"', contentUrl: '/a/x/raw', title: 'A <b>title</b>', colorMode: 'dark' as const, head: { title: 'T & co', description: null, image: 'https://img/x.png' } };
  it('draws a sandboxed, escaped iframe in the reader\'s colour mode, with a readable fallback', () => {
    const markup = documentFrameHtml(frame);
    expect(markup).toContain(`sandbox="${FRAME_SANDBOX}"`);
    expect(markup).toContain(`allow="${FRAME_ALLOW}"`);
    expect(markup).toContain('src="https://x.pages.example/?_pt=&quot;t&quot;"');
    expect(markup).toContain('title="A &lt;b&gt;title&lt;/b&gt;"');
    expect(markup).toContain('class="dark"');
    expect(FRAME_SANDBOX).not.toContain('allow-top-navigation ');
    expect(documentFrameFallback(frame)).toBe('<section data-document-startup class="px-6 pt-16"><h1>A &lt;b&gt;title&lt;/b&gt;</h1><a href="/a/x/raw">Read document content</a></section>');
    expect(DOCUMENT_FRAME_CSS).toContain('.dark{background:#0b0b0c}');
  });

  it('writes the social head, the description only when there is one', () => {
    expect(documentHeadTags(frame.head)).toBe('<title>T &amp; co</title><meta property="og:title" content="T &amp; co"><meta property="og:image" content="https://img/x.png"><meta name="twitter:card" content="summary_large_image">');
    expect(documentHeadTags({ ...frame.head, description: 'About "it"' })).toContain('<meta name="description" content="About &quot;it&quot;">');
  });
});

describe('the raw document door', () => {
  it('serves a public document to anyone and a private one to its owner only', async () => {
    const pub = await publish('public'), priv = await publish('private');
    expect((await serveRawDocument(request(`/a/${pub.id}/raw`), { id: pub.id })).status).toBe(200);
    expect((await serveRawDocument(request(`/a/${priv.id}/raw`, { token: priv.owner.token }), { id: priv.id })).status).toBe(200);
    expect((await serveRawDocument(request(`/a/${priv.id}/raw`), { id: priv.id })).status).toBe(404);
    const stranger = await mintAccountToken('stranger');
    expect((await serveRawDocument(request(`/a/${priv.id}/raw`, { token: stranger.token }), { id: priv.id })).status).toBe(404);
  });

  it('answers 404 for a malformed, unknown or deleted id, a fragment of a native page, and another document\'s origin', async () => {
    const pub = await publish('public');
    expect((await serveRawDocument(request('/a/x/raw'), { id: '../x' })).status).toBe(404);
    expect((await serveRawDocument(request('/a/zzzzzzzz/raw'), { id: 'zzzzzzzz' })).status).toBe(404);
    const marked = markPagesRequest(request(`/a/${pub.id}/raw`), { id: 'otherdoc', self: 'https://x', site: pagesSite() } as never);
    expect((await serveRawDocument(marked, { id: pub.id })).status).toBe(404);
    expect((await serveRawDocument(request(`/a/${pub.id}/raw`), { id: pub.id, fragment: { surface: 'reader' } as never })).status).toBe(404);
    await (await getDb()).query('UPDATE artifacts SET deleted_at = now() WHERE id = $1', [pub.id]);
    expect((await serveRawDocument(request(`/a/${pub.id}/raw`), { id: pub.id })).status).toBe(404);
  });
});

describe('the runtime stylesheet', () => {
  it('reads a version and a bounded set of runtime classes', () => {
    const url = (q: string) => new URL(`https://x/a/doc/runtime.css?${q}`);
    expect(parseRuntimeCssRequest(url('v=3&k=abc&x=p-4%20flex%20flex'))).toEqual({ version: 3, compile: 'abc', extras: ['flex', 'p-4'] });
    expect(parseRuntimeCssRequest(url('v=1'))).toEqual({ version: 1, compile: null, extras: [] });
    for (const bad of ['', 'v=0', 'v=1.5', 'v=x']) expect(parseRuntimeCssRequest(url(bad)), bad).toEqual({ error: 'invalid_version' });
    expect(parseRuntimeCssRequest(url(`v=1&x=${Array.from({ length: 501 }, (_, i) => `c${i}`).join('%20')}`))).toEqual({ error: 'invalid_classes' });
    expect(parseRuntimeCssRequest(url(`v=1&x=${'a'.repeat(121)}`))).toEqual({ error: 'invalid_classes' });
  });

  it('caches the current compile for a year, publicly only when anyone may read, and revalidates a stale one', async () => {
    const row = { id: 'doc1', version: 2, source: '<div class="p-4"></div>' };
    const stale = await runtimeCssAnswer(row, { version: 2, compile: 'old', extras: [] }, true);
    expect(stale.cacheControl).toBe('private, no-cache');
    expect(stale.etag).toMatch(/^"[\w-]{22}"$/);
    const again = await runtimeCssAnswer(row, { version: 2, compile: 'old', extras: ['flex'] }, true);
    expect(again.etag).not.toBe(stale.etag);
  });
});

describe('the native runtime\'s public code', () => {
  it('serves the core and each module revalidated, and the retained alias only for a digest it holds', async () => {
    const core = await nativeHtmlCoreResponse(request('/af/core.js'));
    expect(core.status).toBe(200);
    expect(core.headers.get('content-type')).toContain('javascript');
    const etag = core.headers.get('etag')!;
    expect((await nativeHtmlCoreResponse(request('/af/core.js', { headers: { 'if-none-match': etag } }))).status).toBe(304);
    expect((await nativeHtmlModuleResponse(request('/af/apollo.js'), 'apollo')).status).toBe(200);
    expect((await nativeHtmlApolloResponse(request('/af/v1/apollo/x'), '0'.repeat(64))).status).toBe(404);
    expect((await nativeHtmlReaderResponse(request('/af/v1/reader/x'), '0'.repeat(64))).status).toBe(404);
  });

  it('serves no component module it does not have', async () => {
    const missing = await componentModuleResponse(request('/af/components/nope.js'), 'nope.js');
    expect([missing.status, missing.headers.get('cache-control')]).toEqual([404, 'no-store']);
  });

  it('titles a document by its title, else its <title>, else "Document"', () => {
    expect(nativeHtmlTitle({ title: 'Given', source: html('Ignored') })).toBe('Given');
    expect(nativeHtmlTitle({ title: null, source: html(' From head ') })).toBe('From head');
    expect(nativeHtmlTitle({ title: null, source: '<p>no title</p>' })).toBe('Document');
    expect(nativeHtmlTitle({ title: null, source: null })).toBe('Document');
  });
});

describe('the shell cache', () => {
  const render = (body: string) => async () => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

  it('renders every time for anything but an anonymous GET of a readable document without query or credential', async () => {
    const priv = await publish('private');
    let renders = 0;
    const counted = async () => { renders++; return new Response('shell'); };
    const ask = (path: string, init: Parameters<typeof request>[1] = {}, id: string | null = priv.id) => cachedShell({ request: request(path, init), id, encoding: null, build: 'b1' }, counted);
    await ask(`/a/${priv.id}`);
    await ask(`/a/${priv.id}`);
    await ask(`/a/${priv.id}?x=1`);
    await ask(`/a/${priv.id}/edit`);
    await ask(`/a/${priv.id}`, { method: 'HEAD' });
    await ask(`/a/${priv.id}`, { token: priv.owner.token });
    await ask(`/a/${priv.id}`, { cookie: 'session=abc' });
    await ask('/', {}, null);
    expect(renders).toBe(8);
  });

  it('renders a public document\'s shell once per version and theme, and never keeps a failed or cookie-setting one', async () => {
    const pub = await publish('public');
    let renders = 0;
    const ask = (cookie: string | undefined, answer: () => Promise<Response>) => cachedShell({ request: request(`/a/${pub.id}`, cookie ? { cookie } : {}), id: pub.id, encoding: null, build: 'b1' }, async () => { renders++; return answer(); });
    expect(await (await ask(undefined, render('one'))).text()).toBe('one');
    expect(await (await ask(undefined, render('two'))).text()).toBe('one');
    expect(await (await ask('mx_theme=dark', render('dark'))).text()).toBe('dark');
    expect(await (await ask('mx_theme=dark', render('dark again'))).text()).toBe('dark');
    expect(await (await ask('session=abc', render('with a credential'))).text()).toBe('with a credential');
    expect(await (await ask('mx_theme=dark; session=abc', render('mixed'))).text()).toBe('mixed');
    expect(renders).toBe(4);
    const fresh = await publish('public');
    const failing = () => cachedShell({ request: request(`/a/${fresh.id}`), id: fresh.id, encoding: null, build: 'b1' }, async () => { renders++; return new Response('err', { status: 500 }); });
    await failing();
    await failing();
    expect(renders).toBe(6);
    await (await getDb()).query('UPDATE artifacts SET version = version + 1, updated_at = now() WHERE id = $1', [pub.id]);
    expect(await (await ask(undefined, render('next version'))).text()).toBe('next version');
  });
});
