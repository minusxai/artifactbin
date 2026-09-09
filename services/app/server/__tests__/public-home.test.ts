import { describe, expect, it, vi } from 'vitest';
import { createAppServer } from '../app';
import { request, useAppHarness } from '@/__tests__/harness';
import { AGENT_COOKIE } from '@/lib/agent-session';

useAppHarness();
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>artifactbin</title></head><body><div id="root"></div></body></html>' });

describe('public homepage first response', () => {
  it('contains the landing content and topbar without executing JavaScript', async () => {
    const response = await app.request('/');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Your agents');
    expect(html).toContain('interactive HTML documents');
    expect(html).toContain('aria-label="Home"');
    expect(html).not.toContain('aria-label="Loading page"');
    expect(html).not.toContain('aria-label="Loading workspace"');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(html).toContain('data-mx-initial-home');
  });
  it('treats an invalid cookie as a public visitor', async () => {
    expect(await (await app.request(request('/', { cookie: `session=expired; ${AGENT_COOKIE}=invalid` }))).text()).toContain('Your agents');
  });
  it('does not start or await GitHub while serving homepage HTML', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}));
    try {
      const local = createAppServer({ indexHtml: async () => '<html><head></head><body><div id="root"></div></body></html>' });
      const response = await local.request('/');
      expect(await response.text()).toContain('Your agents');
      expect(upstream).not.toHaveBeenCalled();
    } finally { upstream.mockRestore(); }
  });
  it.each([
    { credential: 'session' as const, userId: 'public-home-user', email: 'private@example.com' },
    { credential: 'agent-cookie' as const, tokenId: 'held-token', heldTokenIds: ['held-token'] },
  ])('does not bootstrap public landing for validated $credential actor', async actor => {
    const response = await app.request(request('/', { actor }));
    const html = await response.text();
    expect(html).not.toContain('Your agents');
    expect(html).not.toContain('private@example.com');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
