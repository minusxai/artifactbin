import { expect, it, vi } from 'vitest';
vi.mock('@/lib/config', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/config')>(),
  get PUBLIC_BASE_URL(){return 'http://localhost:3000';}, CONTROLS_ORIGIN: 'http://i.localhost:3000',
}));
import { createAppServer } from '../app';
import { attachActor, signActor } from '@artifactbin/utils';
import { ACTOR_HEADER } from '@artifactbin/contracts';
import { useAppHarness } from '@/__tests__/harness';
useAppHarness();
const main = 'http://localhost:3000', controls = 'http://i.localhost:3000';
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head></head><body>Trusted SPA</body></html>' });
const throughProxy = (url: string) => app.fetch(attachActor(new Request(url), { credential: 'none' }));
it('refuses direct app access when the controls boundary is enabled', async () => {
  for (const origin of [main, controls]) {
    for (const path of ['/login', '/api/page/session', '/api/my/artifacts']) {
      const res = await app.request(origin + path);
      expect(res.status, origin + path).toBe(403);
      expect(await res.json()).toEqual({ error: 'proxy_required' });
    }
  }
  const split = createAppServer({ actorSecret: 'transport-secret', indexHtml: async () => '<head></head>' });
  expect((await split.request(controls + '/login', { headers: { [ACTOR_HEADER]: 'forged' } })).status).toBe(403);
  expect((await split.request(controls + '/login', { headers: { [ACTOR_HEADER]: signActor({ credential: 'none' }, 'transport-secret') } })).status).toBe(200);
});
it('serves full trusted account pages, and APIs, on the controls host', async () => {
  for (const path of ['/login', '/account', '/tokens/new', '/']) {
    const res = await throughProxy(controls + path);
    expect(res.status, path).toBe(200);
    const html = await res.text();
    expect(html).toContain('Trusted SPA');
    expect(html).toContain('mx-app-config');
    expect(html).not.toContain('mx-controls-config');
  }
  expect((await throughProxy(controls + '/api/page/session')).status).toBe(200);
});
it('dedicates a frameable controls path without serving author document routes there', async () => {
  const res = await throughProxy(controls + '/controls/a/abc123');
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('mx-controls-config');
  expect(res.headers.get('content-security-policy')).toContain(`frame-ancestors ${main}`);
  expect((await throughProxy(controls + '/a/abc123')).status).toBe(404);
});
it('redirects old main-host account pages to top-level trusted pages', async () => {
  for (const path of ['/login?callbackUrl=%2Fa%2Fabc123', '/account', '/tokens/new']) {
    const res = await throughProxy(main + path);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(controls + path);
  }
});
