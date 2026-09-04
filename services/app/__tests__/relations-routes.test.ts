/**
 * The two doors onto relations: like an artifact you can read, follow a user
 * who exists — as a signed-in account only, same-site, with the count in the
 * answer so the button can render without a second call.
 *
 * Seeded RED by the orchestrator (the route files do not exist yet).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeEvents } from '@artifactbin/utils';
import { request, useAppHarness } from '@/__tests__/harness';
import { DELETE as unlike, GET as likeState, POST as like } from '@/app/api/my/artifacts/[id]/like/route';
import { DELETE as unfollow, GET as followState, POST as follow } from '@/app/api/users/[id]/follow/route';
import { createUser } from '@/lib/users';
import { setServices } from '@/lib/services';

const harness = useAppHarness();
const session = (user: { id: string; email: string | null }) => ({ credential: 'session' as const, userId: user.id, email: user.email ?? '', emailVerified: true });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => setServices({ events: fakeEvents() }));

describe('POST/DELETE/GET /api/my/artifacts/[id]/like', () => {
  it('a signed-in reader likes, sees the count, unlikes; anonymous is 401; an unreadable artifact is 404', async () => {
    const owner = await createUser({ email: 'mxmx_test_rel_owner@example.com' });
    const fan = await createUser({ email: 'mxmx_test_rel_fan@example.com' });
    const db = await harness.db();
    await db.query(`INSERT INTO artifacts (id, token_id, user_id, content, visibility) VALUES ('art0pu', 'tok_o', $1, 'x', 'public'), ('art0pr', 'tok_o', $1, 'x', 'private')`, [owner.id]);

    expect((await like(request('/api/my/artifacts/art0pu/like', { method: 'POST', origin: 'same' }), ctx('art0pu'))).status).toBe(401);

    const liked = await like(request('/api/my/artifacts/art0pu/like', { method: 'POST', actor: session(fan), origin: 'same' }), ctx('art0pu'));
    expect(liked.status).toBe(200);
    expect(await liked.json()).toEqual({ liked: true, count: 1 });
    const again = await like(request('/api/my/artifacts/art0pu/like', { method: 'POST', actor: session(fan), origin: 'same' }), ctx('art0pu'));
    expect(await again.json()).toEqual({ liked: true, count: 1 });

    const state = await likeState(request('/api/my/artifacts/art0pu/like', { actor: session(fan) }), ctx('art0pu'));
    expect(await state.json()).toEqual({ liked: true, count: 1 });
    const anonymousState = await likeState(request('/api/my/artifacts/art0pu/like'), ctx('art0pu'));
    expect(await anonymousState.json()).toEqual({ liked: false, count: 1 });

    const unliked = await unlike(request('/api/my/artifacts/art0pu/like', { method: 'DELETE', actor: session(fan), origin: 'same' }), ctx('art0pu'));
    expect(await unliked.json()).toEqual({ liked: false, count: 0 });

    expect((await like(request('/api/my/artifacts/art0pr/like', { method: 'POST', actor: session(fan), origin: 'same' }), ctx('art0pr'))).status).toBe(404);
    expect((await like(request('/api/my/artifacts/nope00/like', { method: 'POST', actor: session(fan), origin: 'same' }), ctx('nope00'))).status).toBe(404);
  });
});

describe('POST/DELETE/GET /api/users/[id]/follow', () => {
  it('follows a user who exists, never yourself, and reports the follower count', async () => {
    const a = await createUser({ email: 'mxmx_test_rel_a@example.com' });
    const b = await createUser({ email: 'mxmx_test_rel_b@example.com' });
    expect((await follow(request(`/api/users/${b.id}/follow`, { method: 'POST', origin: 'same' }), ctx(b.id))).status).toBe(401);
    const followed = await follow(request(`/api/users/${b.id}/follow`, { method: 'POST', actor: session(a), origin: 'same' }), ctx(b.id));
    expect(followed.status).toBe(200);
    expect(await followed.json()).toEqual({ following: true, count: 1 });
    expect((await follow(request(`/api/users/${a.id}/follow`, { method: 'POST', actor: session(a), origin: 'same' }), ctx(a.id))).status).toBe(400);
    expect((await follow(request('/api/users/usr_nobody/follow', { method: 'POST', actor: session(a), origin: 'same' }), ctx('usr_nobody'))).status).toBe(404);
    expect(await (await followState(request(`/api/users/${b.id}/follow`, { actor: session(a) }), ctx(b.id))).json()).toEqual({ following: true, count: 1 });
    expect(await (await unfollow(request(`/api/users/${b.id}/follow`, { method: 'DELETE', actor: session(a), origin: 'same' }), ctx(b.id))).json()).toEqual({ following: false, count: 0 });
  });
});
