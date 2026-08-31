/**
 * DISCOVER: the moment an agent is refused is the moment it needs the pointer. Every `401 unauthorized` JSON body
 * carries `docs` (the shared agent/human docs entry) and `tokens` (/tokens/new), on the request base. Seeded RED.
 */
import { describe, expect, it } from 'vitest';
import { GET as listArtifacts } from '@/app/api/artifacts/route';
import { GET as listMine } from '@/app/api/my/tokens/route';

const BASE = 'http://localhost:3000';

describe('401 bodies', () => {
  it('GET /api/artifacts without a credential names the docs and the token page', async () => {
    const res = await listArtifacts(new Request(`${BASE}/api/artifacts`));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized', docs: `${BASE}/docs`, tokens: `${BASE}/tokens/new` });
  });
  it('a session-only route says the same', async () => {
    const res = await listMine(new Request(`${BASE}/api/my/tokens`));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'unauthorized', docs: `${BASE}/docs`, tokens: `${BASE}/tokens/new` });
  });
  it('a bad bearer is refused with the same hints', async () => {
    const res = await listArtifacts(new Request(`${BASE}/api/artifacts`, { headers: { authorization: 'Bearer mx_' + 'x'.repeat(43) } }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ docs: `${BASE}/docs`, tokens: `${BASE}/tokens/new` });
  });
});
