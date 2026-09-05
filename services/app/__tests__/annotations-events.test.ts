/**
 * A CONVERSATION ON A DOCUMENT, SAID TO THE LOG. Four sentences and their
 * silences: a thread opened (`annotated`), a reply on it (`annotated` again —
 * the object is the artifact and the payload names the ROOT, so an owner's
 * feed reads "someone commented on X" whichever comment it was), a thread
 * closed (`annotation_resolved`, only on the open → resolved move — a reopen
 * has no verb in the catalogue and says NOTHING), and a thread erased
 * (`annotation_deleted`).
 *
 * The subject is the acting ACCOUNT when there is one and the acting TOKEN
 * when there is not — an anonymous agent's comment is still somebody's.
 *
 * Written by the implementer (the phase brief leaves this file to the
 * annotation fixtures) and seen RED against the seed's annotation-free
 * `lib/annotations.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvents, type FakeEvents } from '@artifactbin/utils';
import { useAppHarness } from '@/__tests__/harness';
import { actOnAnnotationFor, createAnnotationFor, deleteAnnotationFor, type AnnotationAuthor } from '@/lib/annotations';
import { createArtifact, type TokenActor } from '@/lib/artifacts';
import { setServices } from '@/lib/services';
import { mintToken } from '@/lib/tokens';
import { createUser } from '@/lib/users';

useAppHarness();

let fake: FakeEvents;
/** A fresh log, so a fixture's own moments never count against the moment under test. */
const listen = () => { fake = fakeEvents(); setServices({ events: fake }); };
beforeEach(listen);

//   source index:      0 = Helmet, 1 = intro <p>, 2 = findings <div>
//   BODY path:                     0 = intro,     1 = findings
const DOC =
  '<Helmet><title>Report</title></Helmet>'
  + '<p>An introduction paragraph.</p>'
  + '<div>Revenue grew 40% in Q3.</div>';

const doc = { format: 'markup' as const, content: '', source: DOC, meta: {}, title: 'Report', description: null };
const author: AnnotationAuthor = { kind: 'human', label: null, transport: 'browser' };

/**
 * Only the annotation verbs. Stamping an anchor and cleaning one back out are
 * REAL document edits, so `edited` rides along on create and on delete; the
 * sentences under test are the ones this file names.
 */
const said = (...verbs: string[]) => fake.events.filter((e) => verbs.includes(e.verb));

/** A markup document owned by an account, plus the actor that speaks for it — with the log reset after the fixture's own `created`. */
async function publish(email: string) {
  const owner = await createUser({ email });
  const tok = await mintToken('web', owner.id, undefined, { expiresInMs: null });
  const row = await createArtifact(tok.id, owner.id, doc);
  await vi.waitFor(() => expect(fake.events.map((e) => e.verb)).toContain('created'));
  listen();
  return { owner, row, actor: { tokenId: tok.id, userId: owner.id } satisfies TokenActor };
}

/** The same document under an ANONYMOUS token — no account behind it at all. */
async function publishAnonymously() {
  const tok = await mintToken('agent');
  const row = await createArtifact(tok.id, null, doc);
  await vi.waitFor(() => expect(fake.events.map((e) => e.verb)).toContain('created'));
  listen();
  return { row, actor: { tokenId: tok.id, userId: null } satisfies TokenActor };
}

const open = async (actor: TokenActor, artifactId: string, baseEditId: string, body: string) => {
  const wire = await createAnnotationFor(actor, artifactId, { bodyPath: '1', baseEditId, body }, author);
  expect(wire, 'the fixture must actually annotate').toMatchObject({ id: expect.any(String) });
  return wire as { id: string };
};

describe('a thread opened', () => {
  it('says artifact.annotated once, on the ARTIFACT, naming the new root — with the account as subject', async () => {
    const { owner, row, actor } = await publish('mxmx_test_ann_open@example.com');
    const wire = await open(actor, row.id, row.edit_id, 'this number looks wrong');
    expect(said('annotated')).toHaveLength(1);
    expect(said('annotated')[0]).toMatchObject({
      source: 'app', verb: 'annotated', subject_kind: 'user', subject_id: owner.id,
      object_kind: 'artifact', object_id: row.id, payload: { annotation_id: wire.id },
    });
    expect(JSON.stringify(said('annotated')[0]), 'the words themselves never travel').not.toContain('this number looks wrong');
  });
  it('speaks for the TOKEN when no account is behind it', async () => {
    const { row, actor } = await publishAnonymously();
    await open(actor, row.id, row.edit_id, 'an agent says so');
    expect(said('annotated')[0]).toMatchObject({ subject_kind: 'token', subject_id: actor.tokenId, object_id: row.id });
  });
  it('a refused create (a stranger, a path that is not there) says nothing', async () => {
    const { row, actor } = await publish('mxmx_test_ann_refused@example.com');
    expect(await createAnnotationFor({ tokenId: 'tok_stranger', userId: 'usr_stranger' }, row.id, { bodyPath: '1', baseEditId: row.edit_id, body: 'nope' }, author)).toBeNull();
    expect(await createAnnotationFor(actor, row.id, { bodyPath: '99', baseEditId: row.edit_id, body: 'nope' }, author)).toMatchObject({ refused: 'bad_path' });
    expect(said('annotated')).toEqual([]);
  });
});

describe('a reply', () => {
  it('says artifact.annotated with the ROOT thread id, never the reply\'s own', async () => {
    const { owner, row, actor } = await publish('mxmx_test_ann_reply@example.com');
    const wire = await open(actor, row.id, row.edit_id, 'this number looks wrong');
    listen();
    const replied = await actOnAnnotationFor(actor, row.id, wire.id, { reply: 'it is right' }, author);
    expect(replied).not.toBeNull();
    expect(said('annotated')).toHaveLength(1);
    expect(said('annotated')[0]).toMatchObject({
      subject_kind: 'user', subject_id: owner.id, object_kind: 'artifact', object_id: row.id,
      payload: { annotation_id: wire.id },
    });
  });
  it('an empty action — no reply, no transition — says nothing at all', async () => {
    const { row, actor } = await publish('mxmx_test_ann_noop@example.com');
    const wire = await open(actor, row.id, row.edit_id, 'a comment');
    listen();
    expect(await actOnAnnotationFor(actor, row.id, wire.id, {}, author)).not.toBeNull();
    expect(await actOnAnnotationFor(actor, row.id, wire.id, { reply: '' }, author)).not.toBeNull();
    expect(await actOnAnnotationFor(actor, row.id, 'ann_nope', { reply: 'to nothing' }, author)).toBeNull();
    expect(fake.events).toEqual([]);
  });
});

describe('a thread closed', () => {
  it('says artifact.annotation_resolved on the open → resolved move, and nothing on repeating it', async () => {
    const { owner, row, actor } = await publish('mxmx_test_ann_resolve@example.com');
    const wire = await open(actor, row.id, row.edit_id, 'please fix');
    listen();
    expect(await actOnAnnotationFor(actor, row.id, wire.id, { resolve: true }, author)).toMatchObject({ status: 'resolved' });
    expect(said('annotation_resolved')).toHaveLength(1);
    expect(said('annotation_resolved')[0]).toMatchObject({
      subject_kind: 'user', subject_id: owner.id, object_kind: 'artifact', object_id: row.id,
      payload: { annotation_id: wire.id },
    });
    listen();
    expect(await actOnAnnotationFor(actor, row.id, wire.id, { resolve: true }, author)).toMatchObject({ status: 'resolved' });
    expect(fake.events, 'already resolved: nothing moved').toEqual([]);
  });
  it('a REOPEN says nothing — the catalogue has no verb for it', async () => {
    const { row, actor } = await publish('mxmx_test_ann_reopen@example.com');
    const wire = await open(actor, row.id, row.edit_id, 'please fix');
    await actOnAnnotationFor(actor, row.id, wire.id, { resolve: true }, author);
    listen();
    expect(await actOnAnnotationFor(actor, row.id, wire.id, { reopen: true }, author)).toMatchObject({ status: 'open' });
    expect(fake.events).toEqual([]);
  });
  it('reply-and-resolve in ONE call says both, in that order', async () => {
    const { row, actor } = await publish('mxmx_test_ann_both@example.com');
    const wire = await open(actor, row.id, row.edit_id, 'please fix');
    listen();
    expect(await actOnAnnotationFor(actor, row.id, wire.id, { reply: 'done', resolve: true }, author)).toMatchObject({ status: 'resolved' });
    expect(said('annotated', 'annotation_resolved').map((e) => e.verb)).toEqual(['annotated', 'annotation_resolved']);
    for (const e of said('annotated', 'annotation_resolved')) expect(e).toMatchObject({ object_id: row.id, payload: { annotation_id: wire.id } });
  });
});

describe('a thread erased', () => {
  it('says artifact.annotation_deleted when a row actually went, and nothing when none did', async () => {
    const { owner, row, actor } = await publish('mxmx_test_ann_delete@example.com');
    const wire = await open(actor, row.id, row.edit_id, 'take this back');
    listen();
    expect(await deleteAnnotationFor(actor, row.id, wire.id)).toBe(true);
    expect(said('annotation_deleted')).toHaveLength(1);
    expect(said('annotation_deleted')[0]).toMatchObject({
      subject_kind: 'user', subject_id: owner.id, object_kind: 'artifact', object_id: row.id,
      payload: { annotation_id: wire.id },
    });
    listen();
    expect(await deleteAnnotationFor(actor, row.id, wire.id), 'already gone').toBe(false);
    expect(await deleteAnnotationFor({ tokenId: 'tok_stranger', userId: 'usr_stranger' }, row.id, wire.id)).toBe(false);
    expect(said('annotation_deleted')).toEqual([]);
  });
});
