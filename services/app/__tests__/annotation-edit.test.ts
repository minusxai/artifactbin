import {nativeHtml} from './native-html-fixture';
import {nativeAnchor} from './native-annotation-fixture';
/**
 * EDITING A COMMENT — its author rewrites the words; nobody else may.
 *
 * Through the real doors: the browser twin (`PATCH /api/my/artifacts/:id/annotations/:annId`) and the bearer
 * `edit_comment` operation (`PATCH /api/artifacts/:id/annotations/:annId`). An edit changes text only (anchor,
 * quote and document stay), stamps `edited_at`, moves the thread revision, refuses a stale revision with 409,
 * and invites only the people it newly mentions.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { useAppHarness, request, mintAccountToken as mintToken } from '@/__tests__/harness';
import { claimToken, createUser, identityForUser } from '@/lib/accounts';
import { createArtifact, getArtifactById, updateSharingFor } from '@/lib/artifacts';
import { getDb } from '@/lib/platform';
import { POST as createRoute } from '@/app/api/my/artifacts/[id]/annotations/route';
import { DELETE as deleteRoute, PATCH as editRoute, POST as actRoute } from '@/app/api/my/artifacts/[id]/annotations/[annId]/route';
import { PATCH as bearerEditRoute } from '@/app/api/artifacts/[id]/annotations/[annId]/route';
import { POST as bearerCreateRoute } from '@/app/api/artifacts/[id]/annotations/route';

useAppHarness();

const SOURCE = '<div data-af-id="root"><p data-af-id="lede">Revenue grew in the third quarter.</p></div>';

async function person(name: string) {
  const user = await createUser({ email: `mxmx_test_edit_${name}@example.com` });
  const token = await mintToken(`edit-${name}`, user.id);
  await claimToken(user.id, token.token);
  return {
    user, token,
    session: { credential: 'session' as const, userId: user.id, email: user.email!, emailVerified: true },
  };
}
type Person = Awaited<ReturnType<typeof person>>;

async function world() {
  const owner = await person('owner'), commenter = await person('commenter'), editor = await person('editor');
  const row = await createArtifact(owner.token.id, owner.user.id, { format: 'html', source: nativeHtml(SOURCE), meta: {}, visibility: 'private', title: 'edits' });
  await updateSharingFor(identityForUser(owner.user.id, owner.token.id), row.id, { shares: [
    { email: commenter.user.email!, role: 'commenter' }, { email: editor.user.email!, role: 'editor' },
  ] });
  return { owner, commenter, editor, id: row.id };
}

const ctx = (id: string, annId?: string) => ({ params: Promise.resolve({ id, ...(annId ? { annId } : {}) }) as Promise<{ id: string; annId: string }> });

interface Thread { id: string; revision: number; status: string; quote: string | null; anchor: { nodeId?: string } | null; thread: Array<{ id: string; body: string; edited_at?: string }> }

async function comment(who: Person, id: string, body: string, extra: Record<string, unknown> = {}): Promise<Thread> {
  const res = await createRoute(request(`/api/my/artifacts/${id}/annotations`, { method: 'POST', actor: who.session, json: { anchor:nativeAnchor('lede',1,typeof extra.quote==='string'?extra.quote:''), body } }), ctx(id));
  expect(res.status, await res.clone().text()).toBe(201);
  return res.json();
}
async function reply(who: Person, id: string, root: string, body: string): Promise<Thread> {
  const res = await actRoute(request(`/api/my/artifacts/${id}/annotations/${root}`, { method: 'POST', actor: who.session, json: { reply: body } }), ctx(id, root));
  expect(res.status, await res.clone().text()).toBe(200);
  return res.json();
}
const edit = (who: Person, id: string, commentId: string, json: unknown) =>
  editRoute(request(`/api/my/artifacts/${id}/annotations/${commentId}`, { method: 'PATCH', actor: who.session, json }), ctx(id, commentId));
const bodies = async (id: string) =>
  Object.fromEntries((await (await getDb()).query<{ id: string; body: string }>('SELECT id, body FROM annotations WHERE artifact_id = $1', [id])).rows.map((r) => [r.id, r.body]));

describe('the author edits their own words', () => {
  it('rewrites a thread\'s first comment: text only, edited_at stamped, revision moved, document untouched', async () => {
    const w = await world();
    const before = await getArtifactById(w.id);
    const made = await comment(w.commenter, w.id, 'Is this the right figure?', { quote: 'third quarter' });
    expect(made.thread[0]!.edited_at).toBeUndefined();

    const res = await edit(w.commenter, w.id, made.id, { body: 'Is this the right **Q3** figure?', expected_revision: made.revision });
    expect(res.status, await res.clone().text()).toBe(200);
    const thread = await res.json() as Thread;
    expect(thread.id).toBe(made.id);
    expect(thread.thread[0]!.body).toBe('Is this the right **Q3** figure?');
    expect(Number.isNaN(Date.parse(thread.thread[0]!.edited_at!))).toBe(false);
    expect(thread.revision).toBe(made.revision + 1);
    expect(thread.quote).toBe(made.quote);
    expect(thread.anchor?.nodeId).toBe('lede');
    const after = await getArtifactById(w.id);
    expect(after!.edit_id).toBe(before!.edit_id);
    expect(after!.source).toBe(before!.source);
    const events = (await (await getDb()).query<{ verb: string }>("SELECT envelope->>'verb' AS verb FROM event_outbox WHERE envelope->>'verb' = 'annotation_edited'")).rows;
    expect(events).toHaveLength(1);
  });

  it('rewrites a reply on a RESOLVED thread, leaving the rest of the conversation as written', async () => {
    const w = await world();
    const made = await comment(w.owner, w.id, 'Check the totals');
    const replied = await reply(w.commenter, w.id, made.id, 'Totals look rigth');
    const replyId = replied.thread[1]!.id;
    const resolved = await actRoute(request(`/api/my/artifacts/${w.id}/annotations/${made.id}`, { method: 'POST', actor: w.owner.session, json: { resolve: true } }), ctx(w.id, made.id));
    const { revision } = await resolved.json() as Thread;

    const res = await edit(w.commenter, w.id, replyId, { body: 'Totals look right', expected_revision: revision });
    expect(res.status, await res.clone().text()).toBe(200);
    const thread = await res.json() as Thread;
    expect(thread.status).toBe('resolved');
    expect(thread.thread.map((c) => c.body)).toEqual(['Check the totals', 'Totals look right']);
    expect(thread.thread[0]!.edited_at).toBeUndefined();
    expect(thread.thread[1]!.edited_at).toBeTruthy();
  });

  it('repeating the current text changes nothing: no revision, no stamp', async () => {
    const w = await world();
    const made = await comment(w.commenter, w.id, 'Same words');
    const res = await edit(w.commenter, w.id, made.id, { body: 'Same words' });
    expect(res.status).toBe(200);
    const thread = await res.json() as Thread;
    expect(thread.revision).toBe(made.revision);
    expect(thread.thread[0]!.edited_at).toBeUndefined();
  });

  it('an agent edits what its own account wrote through the bearer operation, with an Idempotency-Key', async () => {
    const w = await world();
    const made = await bearerCreateRoute(request(`/api/artifacts/${w.id}/annotations`, { method: 'POST', token: w.editor.token.token, json: { anchor:nativeAnchor('lede'), body: 'Agent note' } }), ctx(w.id));
    expect(made.status, await made.clone().text()).toBe(201);
    const thread = await made.json() as Thread;
    const key = randomUUID();
    const send = () => bearerEditRoute(request(`/api/artifacts/${w.id}/annotations/${thread.id}`, {
      method: 'PATCH', token: w.editor.token.token, json: { body: 'Agent note, corrected', expected_revision: thread.revision }, headers: { 'Idempotency-Key': key },
    }), ctx(w.id, thread.id));
    const first = await send();
    expect(first.status, await first.clone().text()).toBe(200);
    expect((await first.json() as Thread).thread[0]!.body).toBe('Agent note, corrected');
    // The same key replays the receipt rather than meeting its own stale revision.
    const again = await send();
    expect(again.status, await again.clone().text()).toBe(200);
    expect((await again.json() as Thread).revision).toBe(thread.revision + 1);
  });
});

describe('nobody else may', () => {
  it('the document owner may delete a commenter\'s comment but not rewrite it; an editor may not either', async () => {
    const w = await world();
    const made = await comment(w.commenter, w.id, 'My own words');
    for (const other of [w.owner, w.editor]) {
      const res = await edit(other, w.id, made.id, { body: 'Words put in their mouth' });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
    const bearer = await bearerEditRoute(request(`/api/artifacts/${w.id}/annotations/${made.id}`, { method: 'PATCH', token: w.owner.token.token, json: { body: 'Nope' } }), ctx(w.id, made.id));
    expect(bearer.status).toBe(404);
    expect((await bodies(w.id))[made.id]).toBe('My own words');
    const removed = await deleteRoute(request(`/api/my/artifacts/${w.id}/annotations/${made.id}`, { method: 'DELETE', actor: w.owner.session }), ctx(w.id, made.id));
    expect(removed.status).toBe(200);
  });

  it('a guest cannot edit, even a comment its own user row wrote', async () => {
    const w = await world();
    const made = await comment(w.commenter, w.id, 'Written before signing out');
    await (await getDb()).query("UPDATE users SET kind = 'guest' WHERE id = $1", [w.commenter.user.id]);
    const res = await edit(w.commenter, w.id, made.id, { body: 'Guest rewrite' });
    expect(res.status).not.toBe(200);
    expect((await bodies(w.id))[made.id]).toBe('Written before signing out');
  });

  it('a stranger meets the uniform 404 for a real comment and an unknown one alike', async () => {
    const w = await world();
    const stranger = await person('stranger');
    const made = await comment(w.commenter, w.id, 'Private words');
    for (const commentId of [made.id, 'ann_missing']) {
      const res = await edit(stranger, w.id, commentId, { body: 'x' });
      expect(res.status).toBe(404);
    }
  });
});

describe('the edit contract', () => {
  it('refuses a stale revision with 409 annotation_conflict and leaves the text alone', async () => {
    const w = await world();
    const made = await comment(w.commenter, w.id, 'First draft');
    await reply(w.owner, w.id, made.id, 'A reply moved the thread');
    const res = await edit(w.commenter, w.id, made.id, { body: 'Second draft', expected_revision: made.revision });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'annotation_conflict', current_revision: made.revision + 1 });
    expect((await bodies(w.id))[made.id]).toBe('First draft');
  });

  it('refuses empty text and a malformed revision', async () => {
    const w = await world();
    const made = await comment(w.commenter, w.id, 'Words');
    for (const json of [{ body: '   ' }, {}, { body: 'ok', expected_revision: -1 }, { body: 'ok', expected_revision: '2' }]) {
      const res = await edit(w.commenter, w.id, made.id, json);
      expect(res.status, JSON.stringify(json)).toBe(400);
      expect((await res.json()).error).toBe('invalid_annotation_edit');
    }
    expect((await bodies(w.id))[made.id]).toBe('Words');
  });

  it('invites only the people the edit newly mentions', async () => {
    const w = await world();
    const bob = await person('bob'), carol = await person('carol');
    const db = await getDb();
    await updateSharingFor(identityForUser(w.owner.user.id, w.owner.token.id), w.id, { shares: [
      { email: w.commenter.user.email!, role: 'commenter' }, { email: w.editor.user.email!, role: 'editor' },
      { email: bob.user.email!, role: 'viewer' }, { email: carol.user.email!, role: 'viewer' },
    ] });
    for (const p of [bob, carol]) {
      await db.query("INSERT INTO relations(subject_kind,subject_id,verb,object_kind,object_id,status,direction,initiated_by) VALUES('user',$1,'join','artifact',$2,'accepted','invitation',$3)", [p.user.id, w.id, w.owner.user.id]);
    }
    const mentioned = async (userId: string) => (await db.query(
      "SELECT 1 FROM event_outbox WHERE envelope->>'verb' = 'mentioned' AND envelope->'payload'->>'user_id' = $1", [userId])).rows.length;
    const made = await comment(w.owner, w.id, `Ask [@bob](/people/${bob.user.id})`);
    expect(await mentioned(bob.user.id)).toBe(1);
    expect(await mentioned(carol.user.id)).toBe(0);

    const res = await edit(w.owner, w.id, made.id, { body: `Ask [@bob](/people/${bob.user.id}) and [@carol](/people/${carol.user.id})` });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await mentioned(bob.user.id)).toBe(1);
    expect(await mentioned(carol.user.id)).toBe(1);
  });
});
