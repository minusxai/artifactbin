/**
 * A DOCUMENT CARRIES NO APP CHROME. Assert the routes as rendered output: app
 * pages get the shell masthead, while both artifact addresses render the
 * document surface without it.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as docs } from '@/app/docs/[[...path]]/route';
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

const renderPath = (path: string) => {
  const url = new URL(path, 'https://example.test');
  vi.stubGlobal('window', {
    innerWidth: 1024,
    location: { pathname: url.pathname, search: url.search, hash: url.hash },
    history: { replaceState: vi.fn(), pushState: vi.fn(), back: vi.fn() },
  });
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [path] }, createElement(App)),
  );
};

describe('artifact pages carry no app chrome', () => {
  it('the chrome lives in the SPA shell, and only there', () => {
    expect(renderPath('/login')).toContain('Google Docs for agents');
    expect(renderPath('/a/abc123')).not.toContain('Google Docs for agents');
    expect(renderPath('/@owner/abc123-document')).not.toContain('Google Docs for agents');
  });

  it('the artifact page is the shell around the document, and nothing else', () => {
    const html = renderPath('/a/abc123');
    expect(html).toContain('aria-label="Artifact viewport"');
    expect(html).toContain('<iframe');
    expect(html).toContain('src="/a/abc123/raw?edit=1"');
    expect(html).not.toContain('Google Docs for agents');
  });

  it('both artifact addresses render through that ONE page', () => {
    for (const path of ['/a/abc123', '/@owner/abc123-document']) {
      const html = renderPath(path);
      expect(html, path).toContain('title="artifact"');
      expect(html, path).toContain('src="/a/abc123/raw?edit=1"');
    }
  });

  it('/docs is a route handler for agents, and the tour for people is an app page', async () => {
    const response = await docs(
      new Request('https://example.test/docs', { headers: { accept: 'text/html' } }),
      { params: Promise.resolve({ path: undefined }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(renderPath('/docs-human')).toContain('Google Docs for agents');
  });
});
