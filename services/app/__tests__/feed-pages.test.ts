/**
 * THE PAGES READ THE LOG. lib/feed's follow feed and decoration, and the three
 * page routes that carry the new state to the SPA: the dashboard's two
 * activity lists, the artifact page's like state, the public profile's owner
 * id and follow state.
 *
 * Seeded RED by the orchestrator. Rows go in the way feed.test.ts puts them in
 * (the service's own declaration, ON CONFLICT DO NOTHING; the harness wipes).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureTable, noopEvents } from '@artifactbin/utils';
import { EVENTS_TABLES } from '@artifactbin/events';
import { request, useAppHarness } from '@/__tests__/harness';
import { GET as artifactPage } from '@/app/api/page/artifact/[id]/route';
import { GET as homePage } from '@/app/api/page/home/route';
import { GET as profilePage } from '@/app/api/page/profile/[user]/[[...path]]/route';
import { createArtifact } from '@/lib/artifacts';
import { EVENTS_SCHEMA } from '@/lib/config';
import { decorateFeed, followFeed, ownerFeed } from '@/lib/feed';
import { link } from '@/lib/relations';
import { setServices } from '@/lib/services';
import { mintToken } from '@/lib/tokens';
import { createUser, type UserRow } from '@/lib/users';

const harness = useAppHarness();
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const session = (user: { id: string; email: string | null }) => ({ credential: 'session' as const, userId: user.id, email: user.email ?? '', emailVerified: true });

let alice: UserRow;
let bob: UserRow;
let carol: UserRow;
/** alice's public and private documents, bob's public one. */
let pubA: string;
let privA: string;
let pubB: string;

async function say(id: string, at: string, subject: [string | null, string | null], verb: string, objectKind: string, objectId: string, payload = '{}') {
  const db = await harness.db();
  await db.query(
    `INSERT INTO ${EVENTS_SCHEMA}.events (id, at, source, subject_kind, subject_id, verb, object_kind, object_id, payload) VALUES ($1, $2, 'app', $3, $4, $5, $6, $7, $8::jsonb) ON CONFLICT (id) DO NOTHING`,
    [id, at, subject[0], subject[1], verb, objectKind, objectId, payload],
  );
}

beforeEach(async () => {
  /*
   * A SILENT FIXTURE. Publishing three documents and minting two tokens says
   * `created` and `minted` to the log — fire-and-forget, so those rows would
   * land at an unpredictable moment DURING a test and count against feeds that
   * assert exact id lists. The writer is swapped for the noop instead of
   * deleting behind it: only the sentences `say()` puts in are ever in there,
   * and the harness owns every wipe (`harness-rollout` pin 4).
   */
  setServices({ events: noopEvents() });
  const db = await harness.db();
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${EVENTS_SCHEMA}`);
  await ensureTable(db, EVENTS_TABLES, { schema: EVENTS_SCHEMA });
  alice = await createUser({ email: 'mxmx_test_feed_alice@example.com' });
  bob = await createUser({ email: 'mxmx_test_feed_bob@example.com' });
  carol = await createUser({ email: 'mxmx_test_feed_carol@example.com' });
  await db.query(`UPDATE users SET username = CASE id WHEN $1 THEN 'alice' WHEN $2 THEN 'bob' ELSE username END WHERE id IN ($1, $2)`, [alice.id, bob.id]);
  const ta = await mintToken('web', alice.id, undefined, { expiresInMs: null });
  const tb = await mintToken('web', bob.id, undefined, { expiresInMs: null });
  const doc = (title: string, visibility: 'public' | 'private') => ({ format: 'markup' as const, content: '', source: '<div>hi</div>', meta: {}, title, description: null, visibility });
  pubA = (await createArtifact(ta.id, alice.id, doc('Alice public', 'public'))).id;
  privA = (await createArtifact(ta.id, alice.id, doc('Alice private', 'private'))).id;
  pubB = (await createArtifact(tb.id, bob.id, doc('Bob public', 'public'))).id;
});

describe('followFeed', () => {
  it('is what the people I follow did, on their PUBLIC artifacts, for the verbs a follower cares about, newest first', async () => {
    await link(carol.id, 'follow', alice.id);
    await link(carol.id, 'follow', bob.id);
    await say('f1', ago(5), ['user', alice.id], 'created', 'artifact', pubA, '{"client":"claude-code"}');
    await say('f2', ago(4), ['user', alice.id], 'created', 'artifact', privA);
    await say('f3', ago(3), ['user', bob.id], 'liked', 'artifact', pubA);
    await say('f4', ago(2), ['user', bob.id], 'created', 'artifact', pubB);
    await say('f5', ago(1), ['visitor', 'v'.repeat(32)], 'viewed', 'artifact', pubB);
    await say('f6', ago(0), ['user', alice.id], 'updated', 'artifact', pubA);
    const feed = await followFeed(carol.id);
    expect(feed.map((e) => e.id), 'f2 is private, f5 a stranger, f6 a verb nobody follows').toEqual(['f4', 'f3', 'f1']);
    expect(feed[2]).toMatchObject({ verb: 'created', subject_id: alice.id, object_id: pubA, payload: { client: 'claude-code' } });
    expect((await followFeed(carol.id, { limit: 2 })).map((e) => e.id)).toEqual(['f4', 'f3']);
  });
  it('is empty when I follow nobody, or when the table is absent', async () => {
    await say('f1', ago(1), ['user', alice.id], 'created', 'artifact', pubA);
    expect(await followFeed(carol.id)).toEqual([]);
    await link(carol.id, 'follow', alice.id);
    expect(await followFeed(carol.id)).toHaveLength(1);
    await (await harness.db()).query(`DROP SCHEMA ${EVENTS_SCHEMA} CASCADE`);
    expect(await followFeed(carol.id)).toEqual([]);
  });
});

describe('decorateFeed', () => {
  it('names the subject by handle and the artifact by title, in two batched lookups, with null where there is no name', async () => {
    await say('d1', ago(3), ['user', bob.id], 'liked', 'artifact', pubA);
    await say('d2', ago(2), ['visitor', 'v'.repeat(32)], 'viewed', 'artifact', pubA);
    await say('d3', ago(1), ['user', carol.id], 'forked', 'artifact', privA, `{"fork_id":"art0zzz"}`);
    await say('d4', ago(0), ['token', 'tok_x'], 'annotated', 'artifact', pubA, '{"annotation_id":"ann_1"}');
    const events = await ownerFeed(alice.id);
    expect(events).toHaveLength(4);
    const db = await harness.db();
    const query = vi.spyOn(db, 'query');
    const items = await decorateFeed(events);
    expect(query.mock.calls.length, 'batched: one for handles, one for titles').toBeLessThanOrEqual(2);
    query.mockRestore();
    expect(items.map((i) => i.id)).toEqual(['d4', 'd3', 'd2', 'd1']);
    expect(items[3]).toEqual({ id: 'd1', at: expect.any(String), verb: 'liked', subject: { kind: 'user', id: bob.id, handle: 'bob' }, object: { kind: 'artifact', id: pubA, title: 'Alice public' }, payload: {} });
    expect(items[2]!.subject).toEqual({ kind: 'visitor', id: 'v'.repeat(32), handle: null });
    expect(items[1]).toMatchObject({ subject: { kind: 'user', id: carol.id, handle: null }, object: { title: 'Alice private' }, payload: { fork_id: 'art0zzz' } });
    expect(items[0]!.subject).toEqual({ kind: 'token', id: 'tok_x', handle: null });
    expect(await decorateFeed([])).toEqual([]);
  });
});

describe('GET /api/page/home', () => {
  it('carries the two decorated lists to a signed-in account; a stranger\'s answer is unchanged', async () => {
    await link(carol.id, 'follow', alice.id);
    await say('h1', ago(2), ['user', bob.id], 'liked', 'artifact', pubA);
    await say('h2', ago(1), ['user', alice.id], 'created', 'artifact', pubA);
    const asAlice = await (await homePage(request('/api/page/home', { actor: session(alice) }))).json();
    expect(asAlice.signedIn).toBe(true);
    expect(asAlice.feed.mine.map((i: { id: string }) => i.id)).toEqual(['h2', 'h1']);
    expect(asAlice.feed.mine[1]).toMatchObject({ verb: 'liked', subject: { handle: 'bob' }, object: { id: pubA, title: 'Alice public' } });
    expect(asAlice.feed.following).toEqual([]);
    const asCarol = await (await homePage(request('/api/page/home', { actor: session(carol) }))).json();
    expect(asCarol.feed.mine).toEqual([]);
    expect(asCarol.feed.following.map((i: { id: string }) => i.id)).toEqual(['h2']);
    expect(asCarol.feed.following[0]).toMatchObject({ verb: 'created', subject: { handle: 'alice' }, object: { title: 'Alice public' } });
    const stranger = await (await homePage(request('/api/page/home'))).json();
    expect(stranger).toEqual({ signedIn: false });
  });
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
  it('a public profile carries the owner\'s id and the viewer\'s follow state; the owner\'s own listing carries neither', async () => {
    await link(carol.id, 'follow', alice.id);
    const ctx = { params: Promise.resolve({ user: '@alice' }) };
    const asCarol = await (await profilePage(request('/api/page/profile/@alice', { actor: session(carol) }), ctx)).json();
    expect(asCarol.kind).toBe('public-profile');
    expect(asCarol.owner).toEqual({ id: alice.id });
    expect(asCarol.follow).toEqual({ following: true, count: 1 });
    const asBob = await (await profilePage(request('/api/page/profile/@alice', { actor: session(bob) }), ctx)).json();
    expect(asBob.follow).toEqual({ following: false, count: 1 });
    const anonymous = await (await profilePage(request('/api/page/profile/@alice'), ctx)).json();
    expect(anonymous.owner).toEqual({ id: alice.id });
    expect(anonymous.follow).toEqual({ following: false, count: 1 });
    const own = await (await profilePage(request('/api/page/profile/@alice', { actor: session(alice) }), ctx)).json();
    expect(own.kind).toBe('owner-listing');
    expect(own.owner).toBeUndefined();
    expect(own.follow).toBeUndefined();
  });
});
