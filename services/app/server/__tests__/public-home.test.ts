import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createAppServer } from '../app';
import { request, useAppHarness } from '@/__tests__/harness';
import { AGENT_COOKIE } from '@/lib/agent-session';

useAppHarness();
const indexHtml = readFileSync(path.resolve(import.meta.dirname, '../../web/index.html'), 'utf8');
const app = createAppServer({ indexHtml: async () => indexHtml });

describe('public homepage first response', () => {
  it('contains the landing content and topbar without executing JavaScript', async () => {
    const response = await app.request('/');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('aria-label="About Artifactbin"');
    expect(html).toContain('Create, edit and share');
    expect(html).toContain('aria-label="Main navigation"');
    expect(html).not.toContain('aria-label="Loading page"');
    expect(html).not.toContain('aria-label="Loading workspace"');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(html).toContain('data-mx-initial-home');
  });
  it('makes the landing stylesheet render-blocking before any initial content', async () => {
    const html = await (await app.request('/')).text();
    const head = html.split('</head>')[0]!;
    expect(head).toMatch(/<link\s+rel="stylesheet"\s+href="\/shell\.css"\s*\/>/);
    expect(html.indexOf('/shell.css')).toBeLessThan(html.indexOf('data-mx-initial-home'));
  });
  it('does not ship marketing scene assets or preloads', async () => {
    const html = await (await app.request('/')).text();
    expect(html).not.toContain('/landing/');
    expect(html).not.toContain('workshop-renderer');
    expect(html).toContain('href="/login"');
  });
  it('treats an invalid cookie as a public visitor', async () => {
    expect(await (await app.request(request('/', { cookie: `session=expired; ${AGENT_COOKIE}=invalid` }))).text()).toContain('aria-label="About Artifactbin"');
  });
  it('does not start or await GitHub while serving homepage HTML', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}));
    try {
      const local = createAppServer({ indexHtml: async () => '<html><head></head><body><div id="root"></div></body></html>' });
      const response = await local.request('/');
      expect(await response.text()).toContain('aria-label="About Artifactbin"');
      expect(upstream).not.toHaveBeenCalled();
    } finally { upstream.mockRestore(); }
  });
  it.each([
    { credential: 'session' as const, userId: 'public-home-user', email: 'private@example.com' },
    { credential: 'agent-cookie' as const, tokenId: 'held-token', heldTokenIds: ['held-token'] },
  ])('does not bootstrap public landing for validated $credential actor', async actor => {
    const response = await app.request(request('/', { actor }));
    const html = await response.text();
    expect(html).not.toContain('aria-label="About Artifactbin"');
    expect(html).not.toContain('private@example.com');
    expect(html).not.toContain('workshop-bot-inspector.glb');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
