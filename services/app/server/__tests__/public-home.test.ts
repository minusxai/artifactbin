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
    expect(html).toContain('aria-label="The artifactbin workshop"');
    expect(html).toContain('interactive HTML documents');
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
  it('discovers the scene mask, robot models, badges and posters before JavaScript', async () => {
    const html = await (await app.request('/')).text();
    const head = html.split('</head>')[0]!;
    expect(head).toContain('/landing/workshop/foreground-mask-gray.png');
    for (const role of ['inspector', 'standing', 'pencil', 'paper']) {
      expect(head).toContain(`/landing/workshop/robots/workshop-bot-${role}.glb?pose=close-inspection-2`);
    }
    expect(head).toContain('/landing/workshop/robots/workshop-arm.glb');
    for (const agent of ['opencode', 'claude', 'codex', 'pi']) expect(head).toContain(`/landing/workshop/robots/badge-${agent}.png`);
    expect(head).toContain('as="fetch" crossorigin="anonymous"');
    expect(head).toContain('/landing/posters/YPLu0U.webp');
  });
  it('preloads local posters in development too', async () => {
    const dev = createAppServer({ indexHtml: async () => indexHtml, devHmrPort: 3041 });
    const head = (await (await dev.request('/')).text()).split('</head>')[0]!;
    expect(head).not.toContain('/__dev/showcase/');
    expect(head).toContain('/landing/posters/YPLu0U.webp');
    expect(head).toContain('workshop-renderer.ts');
    expect(head).not.toContain('/@fs//');
  });
  it('treats an invalid cookie as a public visitor', async () => {
    expect(await (await app.request(request('/', { cookie: `session=expired; ${AGENT_COOKIE}=invalid` }))).text()).toContain('aria-label="The artifactbin workshop"');
  });
  it('does not start or await GitHub while serving homepage HTML', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}));
    try {
      const local = createAppServer({ indexHtml: async () => '<html><head></head><body><div id="root"></div></body></html>' });
      const response = await local.request('/');
      expect(await response.text()).toContain('aria-label="The artifactbin workshop"');
      expect(upstream).not.toHaveBeenCalled();
    } finally { upstream.mockRestore(); }
  });
  it.each([
    { credential: 'session' as const, userId: 'public-home-user', email: 'private@example.com' },
    { credential: 'agent-cookie' as const, tokenId: 'held-token', heldTokenIds: ['held-token'] },
  ])('does not bootstrap public landing for validated $credential actor', async actor => {
    const response = await app.request(request('/', { actor }));
    const html = await response.text();
    expect(html).not.toContain('aria-label="The artifactbin workshop"');
    expect(html).not.toContain('private@example.com');
    expect(html).not.toContain('workshop-bot-inspector.glb');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
