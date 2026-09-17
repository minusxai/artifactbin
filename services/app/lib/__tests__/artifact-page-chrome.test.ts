/**
 * A DOCUMENT CARRIES NO APP CHROME. Assert the routes as rendered output: app
 * pages get the shell masthead, while both artifact addresses render the
 * document surface without it.
 */
import { createElement } from 'react';
import { renderToReadableStream } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/web/App';

vi.mock('@/web/bootstrap', () => ({
  takeBootstrap: (_path: string, which: 'profile' | 'artifact') => {
    if (which === 'profile') return { kind: 'artifact', id: 'abc123' };
    return {
      canonical: '/@owner/abc123-document',
      role: 'owner',
      kind: 'artifact',
      surface: {
        id: 'abc123', editId: 'edit_1', format: 'markup', title: 'Document',
        source: '<h1>Document</h1>', template: null, refs: [], version: 1,
        content: '<h1>Document</h1>', columns: [], compiledCss: null,
        theme: null, colorMode: null,
      },
    };
  },
}));

afterEach(() => vi.unstubAllGlobals());

/** The shell masthead. The tagline beside the brand belongs to the home page alone, so the bar is the mark. */
const MASTHEAD = 'aria-label="Page bar"';

const renderPath = async (path: string) => {
  const url = new URL(path, 'https://example.test');
  vi.stubGlobal('window', {
    innerWidth: 1024,
    location: { pathname: url.pathname, search: url.search, hash: url.hash },
    history: { replaceState: vi.fn(), pushState: vi.fn(), back: vi.fn() },
  });
  const stream = await renderToReadableStream(
    createElement(MemoryRouter, { initialEntries: [path] }, createElement(App)),
  );
  await stream.allReady;
  return new Response(stream).text();
};

describe('artifact pages carry no app chrome', () => {
  it('the chrome lives in the SPA shell, and only there', async () => {
    expect(await renderPath('/login')).toContain(MASTHEAD);
    expect(await renderPath('/a/abc123')).not.toContain(MASTHEAD);
    expect(await renderPath('/@owner/abc123-document')).not.toContain(MASTHEAD);
  });

  it('the artifact page is the shell around the document, and nothing else', async () => {
    const html = await renderPath('/a/abc123');
    expect(html).toContain('aria-label="Artifact viewport"');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('/a/abc123/raw');
    expect(html).not.toContain(MASTHEAD);
  });

  it('both artifact addresses render through that ONE page', async () => {
    for (const path of ['/a/abc123', '/@owner/abc123-document']) {
      const html = await renderPath(path);
      expect(html, path).toContain('aria-label="Artifact viewport"');
      expect(html, path).not.toContain('/a/abc123/raw');
    }
  });

  it('the human tour remains an app page',async()=>{expect(await renderPath('/docs-human')).toContain(MASTHEAD);});
});
