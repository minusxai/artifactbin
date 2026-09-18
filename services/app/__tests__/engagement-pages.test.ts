import { beforeEach, describe, expect, it } from 'vitest';
import { ensureTable, noopEvents } from '@artifactbin/utils';
import { EVENTS_TABLES } from '@artifactbin/events';
import { request, useAppHarness } from '@/__tests__/harness';
import { GET as artifactPage } from '@/app/api/page/artifact/[id]/route';
import { GET as profilePage } from '@/app/api/page/profile/[user]/[[...path]]/route';
import { createArtifact } from '@/lib/artifacts';
import { EVENTS_SCHEMA } from '@/lib/config';
import { link } from '@/lib/relations';
import { setServices } from '@/lib/services';
import { mintToken } from '@/lib/tokens';
import { createUser, type UserRow } from '@/lib/users';

const harness = useAppHarness();
const session = (user: { id: string; email: string | null }) => ({ credential: 'session' as const, userId: user.id, email: user.email ?? '', emailVerified: true });

let alice: UserRow;
let bob: UserRow;
let carol: UserRow;
/** Public artifact for like and profile access checks. */
let pubA: string;

beforeEach(async () => {
  setServices({ events: noopEvents() });
  const db = await harness.db();
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${EVENTS_SCHEMA}`);
  await ensureTable(db, EVENTS_TABLES, { schema: EVENTS_SCHEMA });
  alice = await createUser({ email: 'mxmx_test_feed_alice@example.com' });
  bob = await createUser({ email: 'mxmx_test_feed_bob@example.com' });
  carol = await createUser({ email: 'mxmx_test_feed_carol@example.com' });
  await db.query(`UPDATE users SET username = CASE id WHEN $1 THEN 'alice' WHEN $2 THEN 'bob' ELSE username END WHERE id IN ($1, $2)`, [alice.id, bob.id]);
  const ta = await mintToken('web', alice.id, undefined, { expiresInMs: null });
  const doc = (title: string, visibility: 'public' | 'private') => ({ format: 'markup' as const, content: '', source: '<div>hi</div>', meta: {}, title, description: null, visibility });
  pubA = (await createArtifact(ta.id, alice.id, doc('Alice public', 'public'))).id;
});

describe('GET /api/page/artifact/[id]', () => {
  it('carries the viewer\'s like state and the count', async () => {
    await link(bob.id, 'like', pubA);
    await link(carol.id, 'like', pubA);
    const ctx = { params: Promise.resolve({ id: pubA }) };
    const asBob = await (await artifactPage(request(`/api/page/artifact/${pubA}`, { actor: session(bob) }), ctx)).json();
    expect(asBob.like).toEqual({ liked: true, count: 2 });
    const asAlice = await (await artifactPage(request(`/api/page/artifact/${pubA}`, { actor: session(alice) }), ctx)).json();
    expect(asAlice.like).toEqual({ liked: false, count: 2 });
    const anonymous = await (await artifactPage(request(`/api/page/artifact/${pubA}`), ctx)).json();
    expect(anonymous.like).toEqual({ liked: false, count: 2 });
  });
});

describe('GET /api/page/profile/@handle', () => {
  it('every viewer gets the public profile; strangers also get follow state', async () => {
    await link(carol.id, 'follow', alice.id);
    const ctx = { params: Promise.resolve({ user: '@alice' }) };
    const asCarol = await (await profilePage(request('/api/page/profile/@alice', { actor: session(carol) }), ctx)).json();
    expect(asCarol.kind).toBe('public-profile');
    // `owner` is EVERYONE's half now — it carries the picture the hero draws
    // (lib/avatars), and the owner looking at their own page needs it too.
    expect(asCarol.owner).toEqual({ id: alice.id, image: null });
    expect(asCarol.follow).toEqual({ following: true, count: 1 });
    const asBob = await (await profilePage(request('/api/page/profile/@alice', { actor: session(bob) }), ctx)).json();
    expect(asBob.follow).toEqual({ following: false, count: 1 });
    const anonymous = await (await profilePage(request('/api/page/profile/@alice'), ctx)).json();
    expect(anonymous.owner).toEqual({ id: alice.id, image: null });
    expect(anonymous.follow).toEqual({ following: false, count: 1 });
    const own = await (await profilePage(request('/api/page/profile/@alice', { actor: session(alice) }), ctx)).json();
    expect(own.kind).toBe('public-profile');
    expect(own.files).toEqual(asCarol.files);
    expect(own.owner).toEqual({ id: alice.id, image: null });
    // FOLLOW stays the stranger's half: there is nobody to follow on your own page.
    expect(own.follow).toBeUndefined();
  });
});
