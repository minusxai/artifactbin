/**
 * THE PUBLIC EVENTS FEED over real routes and the real events writer (CONTRACT §6): order and resumption by position,
 * at-least-once redelivery, the comments category without text, access re-checked on every poll, 410 for an expired
 * cursor, per-session `you`, and MinusX job events published to the events service's durable route reaching the
 * members of their group and nobody else. Concurrent commits need real PostgreSQL connections:
 * services/events/__tests__/feed-position-postgres.test.ts.
 */
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { EventEnvelope, EventFeedEvent, EventFeedPage } from '@artifactbin/contracts';
import { AGENT_SESSION_HEADER, EVENTS_ROUTES, SERVICE_AUTH_HEADER } from '@artifactbin/contracts';
import { serveEvents } from '@artifactbin/events';
import { createEvents } from '@artifactbin/events/local';
import { EVENTS_SCHEMA, getDb } from '@/lib/platform';
import { mintAccountToken, request, useAppHarness } from './harness';
import { nativeHtml } from './native-html-fixture';
import { nativeAnchor } from './native-annotation-fixture';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { POST as comment } from '@/app/api/artifacts/[id]/annotations/route';
import { POST as act, PATCH as edit, DELETE as remove } from '@/app/api/artifacts/[id]/annotations/[annId]/route';
import { PUT as react } from '@/app/api/artifacts/[id]/annotations/[annId]/reactions/route';
import { POST as createGroup, GET as listGroups } from '@/app/api/groups/route';
import { POST as invite } from '@/app/api/groups/[id]/invitations/route';
import { DELETE as leave } from '@/app/api/groups/[id]/members/me/route';
import { PUT as share } from '@/app/api/artifacts/[id]/group-shares/[groupId]/route';
import { GET as feed } from '@/app/api/events/route';

useAppHarness();
const context = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
type Token = Awaited<ReturnType<typeof mintAccountToken>>;

const read = async (token: Token, query: Record<string, string>, headers: Record<string, string> = {}) =>
  feed(request(`/api/events?${new URLSearchParams(query)}`, { token: token.token, headers }));
const page = async (token: Token, query: Record<string, string>, headers: Record<string, string> = {}): Promise<EventFeedPage> => {
  const response = await read(token, query, headers);
  expect(response.status, await response.clone().text()).toBe(200);
  return await response.json() as EventFeedPage;
};
const types = (events: EventFeedEvent[]) => events.map(event => event.type);

async function publish(owner: Token, visibility = 'private') {
  const made = await createArtifact(request('/api/artifacts', { method: 'POST', token: owner.token, json: {
    html: nativeHtml('<p data-af-id="intro">Read this</p>'), visibility } }));
  expect(made.status).toBe(201);
  const doc = await made.json() as { id: string; version?: number };
  const say = async (by: Token, body: string, headers: Record<string, string> = {}) => {
    const response = await comment(request(`/api/artifacts/${doc.id}/annotations`, { method: 'POST', token: by.token, headers,
      json: { anchor: nativeAnchor('intro', doc.version ?? 1), body } }), context({ id: doc.id }));
    expect(response.status, await response.clone().text()).toBe(201);
    return (await response.json() as { id: string }).id;
  };
  const thread = (id: string) => ({
    act: async (by: Token, json: Record<string, unknown>, headers: Record<string, string> = {}) =>
      expect((await act(request(`/api/artifacts/${doc.id}/annotations/${id}`, { method: 'POST', token: by.token, json, headers }),
        context({ id: doc.id, annId: id }))).status).toBe(200),
    edit: async (by: Token, body: string) =>
      expect((await edit(request(`/api/artifacts/${doc.id}/annotations/${id}`, { method: 'PATCH', token: by.token, json: { body } }),
        context({ id: doc.id, annId: id }))).status).toBe(200),
    react: async (by: Token, active: boolean) =>
      expect((await react(request(`/api/artifacts/${doc.id}/annotations/${id}/reactions`, { method: 'PUT', token: by.token,
        json: { kind: 'thumbs_up', active } }), context({ id: doc.id, annId: id }))).status).toBe(200),
    remove: async (by: Token) =>
      expect((await remove(request(`/api/artifacts/${doc.id}/annotations/${id}`, { method: 'DELETE', token: by.token }),
        context({ id: doc.id, annId: id }))).status).toBe(200),
  });
  return { doc, say, thread };
}

it('delivers one artifact\'s events in position order, resumes exactly after a cursor or a position, and redelivers an unacknowledged page', async () => {
  const owner = await mintAccountToken('feed-owner');
  const { doc, say, thread } = await publish(owner);
  const start = await page(owner, { artifact_id: doc.id, after: 'now' });
  expect(start.events).toEqual([]);
  const root = await say(owner, 'First');
  await thread(root).act(owner, { reply: 'Second' });
  await thread(root).edit(owner, 'First, rewritten');
  const first = await page(owner, { artifact_id: doc.id, after: start.next });
  expect(types(first.events)).toEqual(['artifact.annotated', 'artifact.annotation_replied', 'artifact.annotation_edited']);
  const positions = first.events.map(event => event.position);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  expect(new Set(positions).size).toBe(3);
  expect(first.events[0]).toMatchObject({ schema_version: 1, resource: { kind: 'artifact', id: doc.id }, payload: { annotation_id: root } });
  // A consumer that crashed before checkpointing asks again from the same cursor: the same events, the same ids.
  expect((await page(owner, { artifact_id: doc.id, after: start.next })).events.map(e => e.id)).toEqual(first.events.map(e => e.id));
  // Resuming after an event's position returns exactly the ones after it.
  expect((await page(owner, { artifact_id: doc.id, after: String(positions[0]) })).events.map(e => e.id)).toEqual(first.events.slice(1).map(e => e.id));
  // From `next`: nothing until something new, then exactly that.
  expect((await page(owner, { artifact_id: doc.id, after: first.next })).events).toEqual([]);
  await thread(root).act(owner, { reply: 'Third' });
  const later = await page(owner, { artifact_id: doc.id, after: first.next });
  expect(types(later.events)).toEqual(['artifact.annotation_replied']);
  expect(later.events[0]!.position).toBeGreaterThan(positions[2]!);
  // `limit` pages through the same order.
  const one = await page(owner, { artifact_id: doc.id, after: start.next, limit: '1' });
  expect(one.events.map(e => e.id)).toEqual([first.events[0]!.id]);
  expect((await page(owner, { artifact_id: doc.id, after: one.next, limit: '1' })).events.map(e => e.id)).toEqual([first.events[1]!.id]);
});

it('category=comments yields created, replied, edited, resolved, reopened, deleted and reaction events, none carrying text', async () => {
  const owner = await mintAccountToken('comments-owner');
  const { doc, say, thread } = await publish(owner);
  // A cursor is bound to its reader and filter: each filter keeps its own.
  const start = await page(owner, { artifact_id: doc.id, after: 'now' });
  const startComments = await page(owner, { artifact_id: doc.id, category: 'comments', after: 'now' });
  const startReactions = await page(owner, { artifact_id: doc.id, types: 'artifact.annotation_reaction_changed', after: 'now' });
  const root = await say(owner, 'SECRET root words');
  await thread(root).act(owner, { reply: 'SECRET reply words' });
  await thread(root).edit(owner, 'SECRET edited words');
  await thread(root).act(owner, { resolve: true });
  await thread(root).act(owner, { reopen: true });
  await thread(root).react(owner, true);
  await thread(root).react(owner, false);
  const reply = (await page(owner, { artifact_id: doc.id, after: start.next })).events[1]!.payload.reply_id as string;
  await thread(reply).remove(owner);
  const { events } = await page(owner, { artifact_id: doc.id, category: 'comments', after: startComments.next });
  expect(types(events)).toEqual(['artifact.annotated', 'artifact.annotation_replied', 'artifact.annotation_edited',
    'artifact.annotation_resolved', 'artifact.annotation_reopened', 'artifact.annotation_reaction_changed',
    'artifact.annotation_reaction_changed', 'artifact.annotation_deleted']);
  expect(events.slice(5, 7).map(e => e.payload)).toEqual([
    { annotation_id: root, kind: 'thumbs_up', active: true, count: 1, agent: true },
    { annotation_id: root, kind: 'thumbs_up', active: false, count: 0, agent: true },
  ]);
  expect(events[7]!.payload).toEqual({ annotation_id: root, reply_id: reply });
  // Ids and state only: no words, and never the credential or session the change was made with.
  expect(JSON.stringify(events)).not.toMatch(/SECRET|"via"|"token_id"|"session"/);
  expect(events.every(e => e.actor?.kind === 'user' && e.actor.id === owner.userId && e.actor.you)).toBe(true);
  // `types` narrows further; an unknown type, category or limit is refused.
  expect(types((await page(owner, { artifact_id: doc.id, types: 'artifact.annotation_reaction_changed', after: startReactions.next })).events))
    .toEqual(['artifact.annotation_reaction_changed', 'artifact.annotation_reaction_changed']);
  for (const [query, code] of [[{ types: 'artifact.viewed' }, 'invalid_types'], [{ category: 'logins' }, 'invalid_category'],
    [{ limit: '201' }, 'invalid_limit'], [{ wait: '31' }, 'invalid_wait']] as const) {
    const refused = await read(owner, query);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: { code } });
  }
});

it('marks `you` per credential and agent session: another agent on the same sign-in is not you', async () => {
  const owner = await mintAccountToken('session-owner');
  const { doc, say } = await publish(owner);
  const start = await page(owner, { artifact_id: doc.id, after: 'now' });
  await say(owner, 'from session a', { [AGENT_SESSION_HEADER]: 'session-aaaa' });
  await say(owner, 'from no named session');
  const as = async (headers: Record<string, string>) => (await page(owner, { artifact_id: doc.id, after: start.next }, headers)).events.map(e => e.actor?.you);
  expect(await as({ [AGENT_SESSION_HEADER]: 'session-aaaa' })).toEqual([true, true]);
  expect(await as({ [AGENT_SESSION_HEADER]: 'session-bbbb' })).toEqual([false, true]);
  // A reader naming no session keeps the credential rule.
  expect(await as({})).toEqual([true, true]);
});

it('stops delivering an artifact\'s events on the next poll after access is lost, and answers 410 to an expired cursor', async () => {
  const owner = await mintAccountToken('access-owner'), member = await mintAccountToken('access-member');
  const made = await createGroup(request('/api/groups', { method: 'POST', token: owner.token, json: { handle: `feed_${randomUUID().slice(0, 8)}`, name: 'Feed' } }));
  const group = await made.json() as { id: string };
  expect((await invite(request(`/api/groups/${group.id}/invitations`, { method: 'POST', token: owner.token, json: { email: member.email, role: 'viewer' } }), context({ id: group.id }))).status).toBe(201);
  await listGroups(request('/api/groups', { actor: { credential: 'session', userId: member.userId!, email: member.email!, emailVerified: true } }));
  const { doc, say } = await publish(owner);
  expect((await share(request(`/api/artifacts/${doc.id}/group-shares/${group.id}`, { method: 'PUT', token: owner.token, json: { role: 'viewer' } }),
    context({ id: doc.id, groupId: group.id }))).status).toBe(200);
  const start = await page(member, { after: 'now' });
  const stranger = await mintAccountToken('access-stranger');
  const strangerStart = await page(stranger, { after: 'now' });
  await say(owner, 'While shared');
  const shared = await page(member, { after: start.next });
  expect(shared.events.map(e => [e.type, e.resource.id])).toEqual([['artifact.annotated', doc.id]]);
  expect(shared.events[0]!.actor).toMatchObject({ id: owner.userId, you: false });
  // A stranger never saw it, filtered or not.
  expect((await page(stranger, { after: strangerStart.next })).events).toEqual([]);
  expect((await read(stranger, { artifact_id: doc.id })).status).toBe(404);

  expect((await leave(request(`/api/groups/${group.id}/members/me`, { method: 'DELETE', token: member.token }), context({ id: group.id }))).status).toBe(200);
  await say(owner, 'After leaving');
  expect((await page(member, { after: shared.next })).events).toEqual([]);
  // Even replaying from before: what is no longer observable is not delivered.
  expect((await page(member, { after: start.next })).events).toEqual([]);
  const filtered = await read(member, { artifact_id: doc.id, after: start.next });
  expect(filtered.status).toBe(404);
  expect(await filtered.json()).toEqual({ error: { code: 'not_found' } });

  // Expired: the event after the cursor left the retention window. And a cursor past the head, and another reader's.
  const db = await getDb();
  await db.query(`UPDATE ${EVENTS_SCHEMA}.events SET accepted_at = now() - interval '31 days' WHERE object_id = $1`, [doc.id]);
  const expired = await read(owner, { artifact_id: doc.id, after: String(shared.events[0]!.position - 1) });
  expect(expired.status).toBe(410);
  expect(await expired.json()).toEqual({ error: { code: 'cursor_expired' } });
  expect((await read(owner, { after: String(Number.MAX_SAFE_INTEGER) })).status).toBe(410);
  const theirs = await read(owner, { after: start.next });
  expect(theirs.status).toBe(400);
  expect(await theirs.json()).toEqual({ error: { code: 'invalid_cursor' } });
});

it('holds a waiting request until an event arrives, and caps concurrent waits per account', async () => {
  const owner = await mintAccountToken('wait-owner');
  const { doc, say } = await publish(owner);
  const start = await page(owner, { artifact_id: doc.id, after: 'now' });
  const began = Date.now();
  const waiting = page(owner, { artifact_id: doc.id, after: start.next, wait: '20' });
  await new Promise(resolve => setTimeout(resolve, 300));
  await say(owner, 'Wake up');
  expect(types((await waiting).events)).toEqual(['artifact.annotated']);
  expect(Date.now() - began).toBeLessThan(10_000);

  const cursor = (await page(owner, { artifact_id: doc.id, after: 'now' })).next;
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  const waits = controllers.map(c => feed(new Request(request(`/api/events?artifact_id=${doc.id}&after=${cursor}&wait=30`, { token: owner.token }), { signal: c.signal })));
  await new Promise(resolve => setTimeout(resolve, 200));
  const refused = await read(owner, { artifact_id: doc.id, after: cursor, wait: '30' });
  expect(refused.status).toBe(429);
  expect(await refused.json()).toEqual({ error: { code: 'too_many_event_waits' } });
  controllers.forEach(c => c.abort(new Error('done')));
  expect((await Promise.all(waits)).map(r => r.status)).toEqual([499, 499, 499, 499]);
}, 30_000);

it('delivers a MinusX job event published to the events service\'s durable route to members of its group only', async () => {
  const owner = await mintAccountToken('job-owner'), outsider = await mintAccountToken('job-outsider');
  const made = await createGroup(request('/api/groups', { method: 'POST', token: owner.token, json: { handle: `jobs_${randomUUID().slice(0, 8)}`, name: 'Jobs' } }));
  const group = await made.json() as { id: string };
  const startOwner = await page(owner, { after: 'now' }), startOutsider = await page(outsider, { after: 'now' });
  const startJobs = await page(owner, { category: 'jobs', after: 'now' }), startComments = await page(owner, { category: 'comments', after: 'now' });
  // The events service as MinusX reaches it: the HTTP shell's publish route, service-authenticated.
  const db = await getDb();
  const server = serveEvents(createEvents({ db: { query: async <T,>(sql: string, params: unknown[] = []) => db.query<T>(sql, params) }, schema: EVENTS_SCHEMA }), { serviceSecret: 'svc' });
  const { url } = server.listen(0);
  const run = (verb: string, groupId: string): EventEnvelope => ({ id: `job:occ_1:${verb}:${groupId}`, at: new Date().toISOString(), source: 'minusx',
    subject_kind: 'service', subject_id: 'minusx', verb, object_kind: 'job', object_id: 'sch_1',
    payload: { schedule_id: 'sch_1', occurrence_id: 'occ_1', group_id: groupId } });
  try {
    const post = (body: EventEnvelope[]) => fetch(url + EVENTS_ROUTES.publish, { method: 'POST',
      headers: { 'content-type': 'application/json', [SERVICE_AUTH_HEADER]: 'svc' }, body: JSON.stringify(body) });
    expect((await post([run('run_started', group.id), run('run_started', 'grp_elsewhere')])).status).toBe(200);
    // A retried publish (same stable id per occurrence and type) is stored once.
    expect((await post([run('run_started', group.id)])).status).toBe(200);
  } finally { await server.close(); }
  const seen = await page(owner, { after: startOwner.next });
  expect(seen.events).toHaveLength(1);
  expect(seen.events[0]).toMatchObject({ type: 'job.run_started', resource: { kind: 'job', id: 'sch_1' },
    actor: { kind: 'service', id: 'minusx', you: false }, payload: { schedule_id: 'sch_1', occurrence_id: 'occ_1', group_id: group.id } });
  expect(types((await page(owner, { category: 'jobs', after: startJobs.next })).events)).toEqual(['job.run_started']);
  expect((await page(owner, { category: 'comments', after: startComments.next })).events).toEqual([]);
  expect((await page(outsider, { after: startOutsider.next })).events).toEqual([]);
});
