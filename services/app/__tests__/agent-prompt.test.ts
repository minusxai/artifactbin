/**
 * POST /api/my/artifacts/:id/agent-prompt — the "hand this document to an
 * agent" button. The session-only route returns the existing-document paste;
 * the agent uses the account token it already holds.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as agentPromptRoute } from '@/app/api/my/artifacts/[id]/agent-prompt/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { existingPaste } from '@/lib/agent-copy';


import { mintToken } from '@/lib/tokens';
import { createUser } from '@/lib/users';
import { useAppHarness, request } from '@/__tests__/harness';

const harness = useAppHarness();

const BASE = 'http://localhost:3000';
const sessionUser = { id: '' };
vi.mock('@/auth', () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id } } : null) }));

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(async () => {
  sessionUser.id = '';
});

describe('POST /api/my/artifacts/:id/agent-prompt', () => {
  it('returns the existing-document paste without minting an unused token', async () => {
    const user = await createUser({ email: 'v@minusx.ai' });
    const agentOne = await mintToken('agent-one', user.id);
    const createRes = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: agentOne.token, json: { title: 'doc', markup: '<section><p>hello</p></section>' } }),
    );
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };

    sessionUser.id = user.id;
    const res = await agentPromptRoute(request(`/api/my/artifacts/${id}/agent-prompt`, { method: 'POST' }), params({ id }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { prompt: string; url: string; token?: string };
    expect(body.url).toBe(`${BASE}/a/${id}`);
    expect(body).not.toHaveProperty('token');
    expect(body.prompt).toBe(existingPaste(BASE, id));
    expect(body.prompt.split('\n').length).toBe(1);
    const tokenCount = await harness.db().then((db) => db.query<{ count: number }>('SELECT count(*)::int AS count FROM tokens'));
    expect(tokenCount.rows[0].count).toBe(1);
  });

  it('404s a document the session does not own, 401s no session', async () => {
    const owner = await createUser({ email: 'v@minusx.ai' });
    const stranger = await createUser({ email: 'w@minusx.ai' });
    const t = await mintToken('t', owner.id);
    const createRes = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<section><p>hi</p></section>' } }),
    );
    const { id } = (await createRes.json()) as { id: string };

    const anon = await agentPromptRoute(request(`/api/my/artifacts/${id}/agent-prompt`, { method: 'POST' }), params({ id }));
    expect(anon.status).toBe(401);

    sessionUser.id = stranger.id;
    const foreign = await agentPromptRoute(request(`/api/my/artifacts/${id}/agent-prompt`, { method: 'POST' }), params({ id }));
    expect(foreign.status).toBe(404);
  });
});
