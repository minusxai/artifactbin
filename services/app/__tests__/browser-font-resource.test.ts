import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { ACTOR_HEADER, ANONYMOUS, BROWSER_FONT_RESOURCE_PATH, BROWSER_SESSION_HEADER, isInternalApiPath } from '@artifactbin/contracts';
import { actorReceiver, signActor } from '@artifactbin/utils';
import { request } from '@/__tests__/harness';
import { GET, POST } from '@/app/api/internal/browser-font-resource/route';

const relay = vi.hoisted(() => ({ fetch: vi.fn(async () => ({ bytes: Buffer.from('body{}'), contentType: 'text/css' })) }));
vi.mock('@/lib/web-ingest/browser-fonts', () => ({ fetchBrowserFontResource: relay.fetch }));

describe('the scripted Google Fonts relay', () => {
  beforeEach(() => relay.fetch.mockClear());

  it('places the relay behind the existing internal API boundary', () => {
    expect(BROWSER_FONT_RESOURCE_PATH).toBe('/api/internal/browser-font-resource');
    expect(isInternalApiPath(BROWSER_FONT_RESOURCE_PATH)).toBe(true);
  });

  it('requires the trusted browser-session mark as well as the attached actor', async () => {
    const target = 'https://fonts.googleapis.com/css2?family=Fraunces';
    expect((await GET(request(`${BROWSER_FONT_RESOURCE_PATH}?url=${encodeURIComponent(target)}`, { headers: { [BROWSER_SESSION_HEADER]: '1' } }))).status).toBe(403);
    expect((await GET(request(`${BROWSER_FONT_RESOURCE_PATH}?url=${encodeURIComponent(target)}`, { actor: ANONYMOUS }))).status).toBe(403);
    expect(relay.fetch).not.toHaveBeenCalled();
  });

  it('relays the original font URL and returns only bounded inert resource headers', async () => {
    const target = 'https://fonts.googleapis.com/css2?family=Fraunces:wght@400;700&display=swap';
    const response = await GET(request(`${BROWSER_FONT_RESOURCE_PATH}?url=${encodeURIComponent(target)}`, {
      actor: ANONYMOUS, headers: { [BROWSER_SESSION_HEADER]: '1', cookie: 'must-not-forward', authorization: 'Bearer must-not-forward' },
    }));
    expect(relay.fetch).toHaveBeenCalledWith(target);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/css');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toBe('body{}');
  });

  it('accepts the signed actor request used by the browser service overHttp hop, including ANONYMOUS', async () => {
    const secret = 'mxmx_test_browser_font_actor_secret';
    const app = new Hono();
    actorReceiver(secret).mount(app);
    app.get(BROWSER_FONT_RESOURCE_PATH, c => GET(c.req.raw));
    const target = 'https://fonts.googleapis.com/css2?family=Fraunces';
    const response = await app.fetch(new Request(`http://app${BROWSER_FONT_RESOURCE_PATH}?url=${encodeURIComponent(target)}`, {
      headers: { [ACTOR_HEADER]: signActor(ANONYMOUS, secret), [BROWSER_SESSION_HEADER]: '1' },
    }));
    expect(response.status).toBe(200);
    expect(relay.fetch).toHaveBeenCalledWith(target);
  });

  it('allows only GET', async () => {
    expect(POST().status).toBe(405);
    expect(relay.fetch).not.toHaveBeenCalled();
  });
});
