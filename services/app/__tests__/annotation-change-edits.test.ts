import {nativeHtml} from './native-html-fixture';
import {nativeAnchor} from './native-annotation-fixture';
/**
 * THE COMMENT FEED CARRIES HUMAN EDITS. A human rewriting a comment after a monitor's checkpoint is delivered once
 * as an edit event (same `type`, `change: 'edited'`, a distinct `event_id`); a comment the monitor has not seen yet
 * arrives once as the ordinary new-comment event with its current words. Agent edits never come back, nor do
 * edits of agent comments or of deleted ones; checkpoints replay the same IDs.
 */
import { expect, it, vi } from 'vitest';
import { getDb } from '@/lib/platform/db';
import type { CommentChangesPage } from '@artifactbin/contracts';
import { useAppHarness, request, mintAccountToken } from '@/__tests__/harness';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { POST as createComment } from '@/app/api/my/artifacts/[id]/annotations/route';
import { DELETE as deleteComment, PATCH as editComment, POST as reply } from '@/app/api/my/artifacts/[id]/annotations/[annId]/route';
import { PATCH as bearerEdit } from '@/app/api/artifacts/[id]/annotations/[annId]/route';
import { POST as bearerCreate } from '@/app/api/artifacts/[id]/annotations/route';
import { GET as changes } from '@/app/api/artifacts/[id]/annotations/changes/route';

useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) as Promise<{ id: string; annId: string }> });

async function fixture() {
  const t = await mintAccountToken('feed-edits');
  const actor = { credential: 'session' as const, userId: t.userId!, email: t.email!, emailVerified: true };
  const made = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { html:nativeHtml('<p data-af-id="intro">Read this</p>') } }));
  expect(made.status).toBe(201);
  const doc = await made.json();
  const comment = async (body: string) => {
    const res = await createComment(request(`/api/my/artifacts/${doc.id}/annotations`, { method: 'POST', actor, json: { anchor:nativeAnchor('intro'), body } }), params({ id: doc.id, annId: '' }));
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; revision: number };
  };
  const edit = async (commentId: string, body: string) => {
    const res = await editComment(request(`/api/my/artifacts/${doc.id}/annotations/${commentId}`, { method: 'PATCH', actor, json: { body } }), params({ id: doc.id, annId: commentId }));
    expect(res.status, await res.clone().text()).toBe(200);
    return res.json();
  };
  const read = async (after: string, extra = ''): Promise<CommentChangesPage> => {
    const res = await changes(request(`/api/artifacts/${doc.id}/annotations/changes?after=${encodeURIComponent(after)}&wait=0${extra}`, { token: t.token }), params({ id: doc.id, annId: '' }));
    expect(res.status).toBe(200);
    return res.json();
  };
  const now = async () => (await read('now')).next_cursor;
  return { t, actor, doc, comment, edit, read, now };
}

it('delivers a human edit after a checkpoint once, as an edit event, and replays its ID', async () => {
  const f = await fixture();
  const root = await f.comment('Make the title shorter');
  const cursor = await f.now();
  await f.edit(root.id, 'Make the title shorter and bolder');
  const page = await f.read(cursor);
  expect(page.events).toHaveLength(1);
  expect(page.events[0]).toMatchObject({
    type: 'artifactbin.comment', change: 'edited', annotation_id: root.id, comment_id: root.id,
    body: 'Make the title shorter and bolder', edited_at: expect.any(String), author: { kind: 'human' },
  });
  expect(page.events[0]!.event_id).not.toBe(root.id);
  expect((await f.read(cursor)).events.map((e) => e.event_id)).toEqual([page.events[0]!.event_id]);
  expect((await f.read(page.next_cursor)).events).toEqual([]);
});

it('a reply edited on an older thread names its root, and new comments keep their unchanged shape', async () => {
  const f = await fixture();
  const root = await f.comment('Root');
  const replied = await reply(request(`/api/my/artifacts/${f.doc.id}/annotations/${root.id}`, { method: 'POST', actor: f.actor, json: { reply: 'Reply' } }), params({ id: f.doc.id, annId: root.id }));
  const replyId = (await replied.json()).thread[1].id as string;
  const cursor = await f.now();
  const fresh = await f.comment('A brand new request');
  await f.edit(replyId, 'Reply, clarified');
  const page = await f.read(cursor);
  expect(page.events.map((e) => [e.comment_id, e.change ?? 'new', e.body])).toEqual([[fresh.id, 'new', 'A brand new request'], [replyId, 'edited', 'Reply, clarified']]);
  expect(page.events[0]).not.toHaveProperty('change');
  expect(page.events[0]).not.toHaveProperty('edited_at');
  expect(page.events[0]!.event_id).toBe(fresh.id);
  expect(page.events[1]!.annotation_id).toBe(root.id);
});

it('a comment created and edited before the monitor reads arrives once, as a new comment with its current words', async () => {
  const f = await fixture();
  const cursor = await f.now();
  const root = await f.comment('Frist draft');
  await f.edit(root.id, 'First draft');
  const page = await f.read(cursor);
  expect(page.events).toHaveLength(1);
  expect(page.events[0]).toMatchObject({ event_id: root.id, comment_id: root.id, body: 'First draft' });
  expect(page.events[0]).not.toHaveProperty('change');
});

it('two edits between reads collapse to one event carrying the latest words', async () => {
  const f = await fixture();
  const root = await f.comment('One');
  const cursor = await f.now();
  await f.edit(root.id, 'Two');
  await f.edit(root.id, 'Three');
  const page = await f.read(cursor);
  expect(page.events.map((e) => [e.change, e.body])).toEqual([['edited', 'Three']]);
});

it('never delivers agent edits, edits of agent comments, unchanged text, or edits of deleted comments', async () => {
  const f = await fixture();
  const human = await f.comment('Human words');
  const agentMade = await bearerCreate(request(`/api/artifacts/${f.doc.id}/annotations`, { method: 'POST', token: f.t.token, json: { anchor:nativeAnchor('intro'), body: 'Agent words' } }), params({ id: f.doc.id, annId: '' }));
  const agent = (await agentMade.json()) as { id: string };
  const doomed = await f.comment('Soon gone');
  const cursor = await f.now();
  const bearer = (id: string, body: string) => bearerEdit(request(`/api/artifacts/${f.doc.id}/annotations/${id}`, { method: 'PATCH', token: f.t.token, json: { body } }), params({ id: f.doc.id, annId: id }));
  // The agent's own account wrote the human comment, so it may rewrite it, but its own edit is never echoed back.
  expect((await bearer(human.id, 'Human words, agent-tidied')).status).toBe(200);
  expect((await bearer(agent.id, 'Agent words, revised')).status).toBe(200);
  await f.edit(human.id, 'Human words, agent-tidied');
  await f.edit(doomed.id, 'Soon gone, edited');
  const removed = await deleteComment(request(`/api/my/artifacts/${f.doc.id}/annotations/${doomed.id}`, { method: 'DELETE', actor: f.actor }), params({ id: f.doc.id, annId: doomed.id }));
  expect(removed.status).toBe(200);
  const page = await f.read(cursor);
  expect(page.events).toEqual([]);
  expect((await f.read(cursor, '&limit=1')).has_more).toBe(false);
});

it('a baseline taken after an edit does not deliver it again', async () => {
  const f = await fixture();
  const root = await f.comment('Words');
  await f.edit(root.id, 'Better words');
  expect((await f.read(await f.now())).events).toEqual([]);
});

it('allocates an edit\'s feed position only after locking the artifact', async () => {
  const f = await fixture();
  const root = await f.comment('Root');
  const db = await getDb(); const original = db.transaction.bind(db); const statements: string[][] = [];
  const spy = vi.spyOn(db, 'transaction').mockImplementation((fn) => original((tx) => {
    const queries: string[] = []; statements.push(queries);
    return fn({ query: async (sql: string, values?: unknown[]) => { queries.push(sql); return tx.query(sql, values); } } as never);
  }));
  try { await f.edit(root.id, 'Root, edited'); } finally { spy.mockRestore(); }
  const editing = statements.find((queries) => queries.some((sql) => sql.includes('nextval')));
  expect(editing, 'the edit allocates a sequence position').toBeTruthy();
  const lock = editing!.findIndex((sql) => sql.includes('FROM artifacts') && sql.endsWith('FOR UPDATE'));
  const allocate = editing!.findIndex((sql) => sql.includes('nextval'));
  expect(lock).toBeGreaterThanOrEqual(0);
  expect(lock).toBeLessThan(allocate);
});

it('says which comments are from the watching account\'s own user: author.you', async () => {
  const f = await fixture();
  const { createUser, claimToken } = await import('@/lib/accounts');
  const { updateSharingFor } = await import('@/lib/artifacts');
  const { identityForUser } = await import('@/lib/accounts');
  const colleague = await createUser({ email: 'mxmx_test_feed_colleague@example.com' });
  const colleagueToken = await mintAccountToken('feed-colleague', colleague.id); await claimToken(colleague.id, colleagueToken.token);
  await updateSharingFor(identityForUser(f.t.userId!, f.t.id), f.doc.id, { shares: [{ email: colleague.email!, role: 'commenter' }] });
  const cursor = await f.now();
  const mine = await f.comment('From the owner');
  const theirs = await createComment(request(`/api/my/artifacts/${f.doc.id}/annotations`, { method: 'POST', actor: { credential: 'session', userId: colleague.id, email: colleague.email!, emailVerified: true }, json: { anchor:nativeAnchor('intro'), body: 'From a colleague' } }), params({ id: f.doc.id, annId: '' }));
  expect(theirs.status).toBe(201);
  const page = await f.read(cursor);
  expect(page.events.map((e) => [e.body, e.author.you])).toEqual([['From the owner', true], ['From a colleague', false]]);
  expect(page.events[0]!.comment_id).toBe(mine.id);
  // The colleague watching the same document sees it the other way round.
  const theirView = await changes(request(`/api/artifacts/${f.doc.id}/annotations/changes?after=${encodeURIComponent(cursor)}&wait=0`, { token: colleagueToken.token }), params({ id: f.doc.id, annId: '' }));
  expect(theirView.status).toBe(400); // a checkpoint is the account's own; the colleague starts from its own baseline
  const base = await changes(request(`/api/artifacts/${f.doc.id}/annotations/changes?after=now&wait=0`, { token: colleagueToken.token }), params({ id: f.doc.id, annId: '' }));
  const colleagueCursor = (await base.json()).next_cursor as string;
  await f.edit(mine.id, 'From the owner, edited');
  const seen = await (await changes(request(`/api/artifacts/${f.doc.id}/annotations/changes?after=${encodeURIComponent(colleagueCursor)}&wait=0`, { token: colleagueToken.token }), params({ id: f.doc.id, annId: '' }))).json() as CommentChangesPage;
  expect(seen.events.map((e) => [e.body, e.change, e.author.you])).toEqual([['From the owner, edited', 'edited', false]]);
});
