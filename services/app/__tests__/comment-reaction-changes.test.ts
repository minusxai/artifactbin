import {nativeHtml} from './native-html-fixture';
import {nativeAnchor} from './native-annotation-fixture';
/**
 * THE COMMENT FEED CARRIES EVERYONE'S REACTIONS. A person or an agent adding or removing a reaction past a monitor's
 * checkpoint is one `artifactbin.comment_reaction` event on the same cursor as comments, with the reactor (`you` for the
 * watching credential) and the new count. Only the net change since a checkpoint arrives (no ghost for
 * added-then-removed, no duplicate for removed-then-re-added); reactions on deleted comments never arrive; checkpoints
 * replay the same IDs.
 */
import {expect, it} from 'vitest';
import type {CommentChangesPage, CommentReactionChangeEvent} from '@artifactbin/contracts';
import {useAppHarness, request, mintAccountToken} from '@/__tests__/harness';
import { createUser, ownerUsername } from '@/lib/accounts';
import {updateSharingFor} from '@/lib/artifacts';
import { identityForUser } from '@/lib/accounts';
import {POST as createArtifact} from '@/app/api/artifacts/route';
import {POST as createComment} from '@/app/api/my/artifacts/[id]/annotations/route';
import {DELETE as deleteComment} from '@/app/api/my/artifacts/[id]/annotations/[annId]/route';
import {PUT as react} from '@/app/api/my/artifacts/[id]/annotations/[annId]/reactions/route';
import {PUT as bearerReact} from '@/app/api/artifacts/[id]/annotations/[annId]/reactions/route';
import {POST as bearerCreate} from '@/app/api/artifacts/[id]/annotations/route';
import {GET as changes} from '@/app/api/artifacts/[id]/annotations/changes/route';

useAppHarness();
const params = (p: {id: string; annId?: string}) => ({params: Promise.resolve({annId: '', ...p})});

async function fixture() {
 const t = await mintAccountToken('reaction-feed');
 const owner = {credential: 'session' as const, userId: t.userId!, email: t.email!, emailVerified: true};
 const made = await createArtifact(request('/api/artifacts', {method: 'POST', token: t.token, json: {html: nativeHtml('<p data-af-id="intro">Read this</p>')}}));
 expect(made.status).toBe(201);
 const doc = await made.json();
 const alice = await createUser({email: 'mxmx_test_reaction_feed_alice@example.com'});
 await updateSharingFor(identityForUser(t.userId!, t.id), doc.id, {shares: [{email: alice.email!, role: 'viewer'}]});
 const aliceSession = {credential: 'session' as const, userId: alice.id, email: alice.email!, emailVerified: true};
 // The agent's proposal: a bearer comment, never itself a feed event.
 const proposal = await bearerCreate(request(`/api/artifacts/${doc.id}/annotations`, {method: 'POST', token: t.token, json: {anchor: nativeAnchor('intro'), body: 'Shall I tighten the intro?'}, headers: {'Artifactbin-Agent': 'Claude Code'}}), params({id: doc.id}));
 expect(proposal.status, await proposal.clone().text()).toBe(201);
 const thread = await proposal.json() as {id: string};
 const human = async (body: string) => {
  const res = await createComment(request(`/api/my/artifacts/${doc.id}/annotations`, {method: 'POST', actor: owner, json: {anchor: nativeAnchor('intro'), body}}), params({id: doc.id}));
  expect(res.status).toBe(201);
  return (await res.json()) as {id: string};
 };
 const reactAs = async (who: typeof owner, active: boolean, commentId = thread.id) => {
  const res = await react(request(`/api/my/artifacts/${doc.id}/annotations/${commentId}/reactions`, {method: 'PUT', actor: who, json: {kind: 'thumbs_up', active}}), params({id: doc.id, annId: commentId}));
  expect(res.status, await res.clone().text()).toBe(200);
 };
 const read = async (after: string, extra = ''): Promise<CommentChangesPage> => {
  const res = await changes(request(`/api/artifacts/${doc.id}/annotations/changes?after=${encodeURIComponent(after)}&wait=0${extra}`, {token: t.token}), params({id: doc.id}));
  expect(res.status, await res.clone().text()).toBe(200);
  return res.json();
 };
 // Baseline after the proposal: these tests are about what happens to it next.
 const cursor = (await read('now')).next_cursor;
 return {t, doc, owner, alice, aliceSession, thread, human, reactAs, read, cursor};
}
const reactionEvents = (page: CommentChangesPage) => page.events.filter((event): event is CommentReactionChangeEvent => event.type === 'artifactbin.comment_reaction');

it('delivers a person adding and then removing a 👍 on the agent proposal, with the reactor and the new count', async () => {
 const f = await fixture();
 await f.reactAs(f.aliceSession, true);
 const added = await f.read(f.cursor);
 expect(added.events).toEqual([{
  type: 'artifactbin.comment_reaction', event_id: expect.any(String), artifact_id: f.doc.id, annotation_id: f.thread.id, comment_id: f.thread.id,
  change: 'added', kind: 'thumbs_up', count: 1, reactor: {kind: 'human', label: await ownerUsername(f.alice.id), user_id: f.alice.id, you: false}, created_at: expect.any(String),
 }]);
 await f.reactAs(f.owner, true);
 const second = await f.read(added.next_cursor);
 expect(reactionEvents(second).map(e => [e.change, e.count, e.reactor.user_id, e.reactor.you])).toEqual([['added', 2, f.owner.userId, false]]); // the owner in the browser, not the watching token
 await f.reactAs(f.aliceSession, false);
 const removed = await f.read(second.next_cursor);
 expect(reactionEvents(removed).map(e => [e.change, e.count, e.reactor.user_id])).toEqual([['removed', 1, f.alice.id]]);
 // Replay from a cursor gives the same IDs; the latest cursor is quiet.
 expect((await f.read(second.next_cursor)).events.map(e => e.event_id)).toEqual(removed.events.map(e => e.event_id));
 expect((await f.read(removed.next_cursor)).events).toEqual([]);
 // From the first baseline, the window nets out per account: alice added and removed (nothing), the owner added.
 expect(reactionEvents(await f.read(f.cursor)).map(e => [e.change, e.reactor.user_id])).toEqual([['added', f.owner.userId]]);
});

it('produces no ghost or duplicate for toggles within one checkpoint, and repeats of the same state change nothing', async () => {
 const f = await fixture();
 await f.reactAs(f.aliceSession, true);
 await f.reactAs(f.aliceSession, false);
 const ghost = await f.read(f.cursor);
 expect(ghost.events).toEqual([]);
 await f.reactAs(f.aliceSession, true);
 await f.reactAs(f.aliceSession, true); // a retry of the same desired state is no change
 const added = await f.read(ghost.next_cursor);
 expect(reactionEvents(added)).toHaveLength(1);
 // Removed and re-added after the monitor saw it: the state it saw is the state now, so no event.
 await f.reactAs(f.aliceSession, false);
 await f.reactAs(f.aliceSession, true);
 expect((await f.read(added.next_cursor)).events).toEqual([]);
 await f.reactAs(f.aliceSession, false);
 await f.reactAs(f.aliceSession, false);
 expect(reactionEvents(await f.read(added.next_cursor)).map(e => [e.change, e.count])).toEqual([['removed', 0]]);
});

it('orders reactions with comments on one cursor, pages both, and resumes exactly from a page checkpoint', async () => {
 const f = await fixture();
 const first = await f.human('First human comment');
 await f.reactAs(f.aliceSession, true, first.id);
 const second = await f.human('Second human comment');
 const all = await f.read(f.cursor);
 expect(all.events.map(e => e.type === 'artifactbin.comment' ? e.body : `${e.change}:${e.comment_id}`)).toEqual(['First human comment', `added:${first.id}`, 'Second human comment']);
 const p1 = await f.read(f.cursor, '&limit=2');
 expect(p1.events.map(e => e.type)).toEqual(['artifactbin.comment', 'artifactbin.comment_reaction']);expect(p1.has_more).toBe(true);
 const p2 = await f.read(p1.next_cursor, '&limit=2');
 expect(p2.events.map(e => e.comment_id)).toEqual([second.id]);expect(p2.has_more).toBe(false);
 expect([...p1.events, ...p2.events].map(e => e.event_id)).toEqual(all.events.map(e => e.event_id));
 // A baseline taken after a reaction never replays it.
 expect((await f.read((await f.read('now')).next_cursor)).events).toEqual([]);
});

it('delivers an agent’s reaction marked `you` for the watching credential, and nets out an agent toggle', async () => {
 const f = await fixture();
 const agentReact = (active: boolean) => bearerReact(request(`/api/artifacts/${f.doc.id}/annotations/${f.thread.id}/reactions`, {method: 'PUT', token: f.t.token, json: {kind: 'thumbs_up', active}, headers: {'Artifactbin-Agent': 'Claude Code'}}), params({id: f.doc.id, annId: f.thread.id}));
 expect((await agentReact(true)).status).toBe(200);
 const page = await f.read(f.cursor);
 expect(page.events).toEqual([expect.objectContaining({type: 'artifactbin.comment_reaction', change: 'added', count: 1, reactor: {kind: 'agent', label: 'Claude Code', user_id: null, you: true}})]);
 // Another person's reaction in the browser is another credential: not `you`.
 await f.reactAs(f.aliceSession, true);
 const next = await f.read(page.next_cursor);
 expect(reactionEvents(next).map(e => [e.reactor.kind, e.reactor.you, e.count])).toEqual([['human', false, 2]]);
 expect((await agentReact(false)).status).toBe(200);
 expect((await agentReact(true)).status).toBe(200);
 expect((await f.read(next.next_cursor)).events).toEqual([]);
});

it('never delivers reactions on deleted comments, while still advancing past them', async () => {
 const f = await fixture();
 const doomed = await f.human('Will be deleted');
 const seen = await f.read(f.cursor);
 await f.reactAs(f.aliceSession, true, doomed.id);
 const gone = await deleteComment(request(`/api/my/artifacts/${f.doc.id}/annotations/${doomed.id}`, {method: 'DELETE', actor: f.owner}), params({id: f.doc.id, annId: doomed.id}));
 expect(gone.status).toBe(200);
 const after = await f.read(seen.next_cursor);
 expect(after.events).toEqual([]);expect(after.next_cursor).not.toBe(seen.next_cursor);
});
