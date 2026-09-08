import { ACTOR_HEADER, type Actor } from '@artifactbin/contracts';
import { signActor } from '@artifactbin/utils';
import { describe, expect, it, vi } from 'vitest';
import { createUser } from '@/lib/users';
import { useAppHarness } from '@/__tests__/harness';

vi.mock('@/lib/config', async original => ({ ...await original<typeof import('@/lib/config')>(), CONTROLS_ORIGIN: null, SSR_ENABLED: false }));
import { createAppServer } from '../app';
useAppHarness();
const secret = 'same-origin-pages-fixture-secret';
const app = createAppServer({ actorSecret: secret, indexHtml: async () => '<!doctype html><html><head><title>artifactbin</title></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>' });
const headers = (actor: Actor) => ({ [ACTOR_HEADER]: signActor(actor, secret), accept: 'text/html' });

describe('same-origin initial app responses with dynamic SSR disabled', () => {
  it('serves useful static logged-out landing HTML, without a framing wait', async () => {
    const response = await app.request('/', { headers: headers({ credential: 'none' }) });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/<h1[\s>]/);
    expect(html).not.toContain('Loading artifactbin');
    expect(html).not.toMatch(/<iframe\b/);
  });

  it('chooses the workspace skeleton before first paint for a valid session', async () => {
    const user = await createUser({ email: 'mxmx_test_same_origin_pages@example.com' });
    const response = await app.request('/', { headers: headers({ credential: 'session', userId: user.id, email: user.email }) });
    const html = await response.text();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(html).toContain('aria-label="Loading workspace"');
    expect(html).not.toMatch(/<iframe\b/);
    expect(html).not.toContain('Loading artifactbin');
  });

  it('offers a themed account shell rather than blank or cross-origin frame HTML', async () => {
    const user = await createUser({ email: 'mxmx_test_same_origin_account@example.com' });
    const response = await app.request('/account', { headers: headers({ credential: 'session', userId: user.id, email: user.email }) });
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('aria-label="Loading account"');
    expect(html).not.toMatch(/<iframe\b/);
    expect(html).not.toContain('Loading artifactbin');
  });
});
