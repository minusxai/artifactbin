/**
 * Every route composes one shared trusted masthead; the authored document
 * surface remains separate. Browser tests prove the actual shadow boundary.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as docs } from '@/app/docs/[[...path]]/route';
import { App } from '@/web/App';

// Inspect route composition without requiring a browser-created portal target.
// shared-trusted-shell.ui.test.tsx covers the real Shadow DOM boundary.
vi.mock('@/web/TrustedAppShell', () => ({TrustedAppShell: ({children}: {children: import('react').ReactNode}) => children}));

vi.mock('@/web/bootstrap', () => ({
  pageBootstrap: () => null,
  invalidateBootstrap: () => {},
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

describe('artifact pages share trusted app chrome', () => {
  it('each route composes exactly one masthead', () => {
    for(const path of ['/login','/a/abc123','/@owner/abc123-document'])expect(renderPath(path).split(MASTHEAD)).toHaveLength(2);
  });

  it('the artifact page mounts the top-level surface beside one trusted masthead', () => {
    const html = renderPath('/a/abc123');
    expect(html).toContain('aria-label="Artifact viewport"');
    expect(html).toContain('data-artifact-story-host="true"');
    expect(html).not.toContain('<iframe');
    expect(html.split(MASTHEAD)).toHaveLength(2);
  });

  it('both artifact addresses render through that ONE page', () => {
    for (const path of ['/a/abc123', '/@owner/abc123-document']) {
      const html = renderPath(path);
      expect(html, path).toContain('data-artifact-story-host="true"');
      expect(html, path).not.toContain('title="artifact"');
    }
  });

  it('/docs is a route handler for agents, and the tour for people is an app page', async () => {
    const response = await docs(
      new Request('https://example.test/docs', { headers: { accept: 'text/html' } }),
      { params: Promise.resolve({ path: undefined }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(renderPath('/docs-human')).toContain(MASTHEAD);
  });
});
