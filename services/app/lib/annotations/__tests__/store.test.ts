import { describe, expect, it } from 'vitest';
import type { AnnotationAuthor, HtmlNodeAnchor } from '@artifactbin/contracts';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';
import { ANONYMOUS_ACTOR, ARTIFACTBIN_AGENT_HEADER, identityForUser } from '@/lib/accounts';
import { createArtifact, getArtifactById } from '@/lib/artifacts';
import { getDb } from '@/lib/platform';
import { POST as createRoute } from '@/app/api/artifacts/route';
import {
  CommentWaitCapacityError, InvalidCommentCursor, actOnAnnotationFor, annotationAuthorForRequest, artifactToWireWithAnnotations, artifactWireFor,
  countOpenAnnotations, createAnnotationFor, deleteAnnotationFor, listAnnotationPageFor, listAnnotationsFor, readArtifactSnapshot, readCommentChangesFor,
  respondToAnnotationAction, respondToAnnotationEdit, respondToCommentReaction,
} from '..';

useAppHarness();
const BASE = 'http://localhost:3000';
const human: AnnotationAuthor = { kind: 'human', label: 'Reviewer', transport: 'browser' };
const agent: AnnotationAuthor = { kind: 'agent', label: 'Codex', transport: 'http' };
const anchor = (nodeId: string, revision = '1'): HtmlNodeAnchor => ({ kind: 'html-node', v: 1, nodeId, revision, quote: '' });
type Wire = { id: string; status: string; thread: Array<{ id: string; body: string }>; revision?: number };

async function fixture(visibility = 'private') {
  const token = await mintAccountToken('annotations-owner');
  const made = await createRoute(request('/api/artifacts', { method: 'POST', token: token.token, json: { html: '<!doctype html><html><head></head><body><p data-af-id="intro">Read this</p><p data-af-id="next">Then this</p></body></html>', visibility } }));
  expect(made.status).toBe(201);
  const doc = await made.json() as { id: string };
  const owner = identityForUser(token.userId!, token.id);
  const comment = async (body: string, nodeId = 'intro', by = owner, author = human) => await createAnnotationFor(by, doc.id, { anchor: anchor(nodeId), body }, author) as Wire;
  return { token, doc, owner, comment };
}
const stranger = async () => { const t = await mintAccountToken('annotations-stranger'); return identityForUser(t.userId!, t.id); };

describe('createAnnotationFor', () => {
  it('opens a thread on a node of the current revision', async () => {
    const f = await fixture();
    const wire = await f.comment('Looks good ü');
    expect(wire).toMatchObject({ status: 'open', orphaned: false, thread: [{ body: 'Looks good ü' }] });
    expect(wire.id).toMatch(/^ann_/);
  });

  it('refuses a stale revision, an unknown node, a malformed anchor or view state, and answers null without access', async () => {
    const f = await fixture();
    expect(await createAnnotationFor(f.owner, f.doc.id, { anchor: anchor('intro', '9'), body: 'x' }, human)).toMatchObject({ refused: 'stale', head: { version: 1 } });
    expect(await createAnnotationFor(f.owner, f.doc.id, { anchor: anchor('missing'), body: 'x' }, human)).toEqual({ refused: 'bad_path' });
    expect(await createAnnotationFor(f.owner, f.doc.id, { anchor: anchor('intro', 'one'), body: 'x' }, human)).toEqual({ refused: 'invalid_annotation_revision' });
    expect(await createAnnotationFor(f.owner, f.doc.id, { body: 'x' }, human)).toEqual({ refused: 'bad_path' });
    expect(await createAnnotationFor(f.owner, f.doc.id, { anchor: anchor('intro'), body: 'x', viewState: { v: 99 } as never }, human)).toEqual({ refused: 'bad_view_state' });
    expect(await createAnnotationFor(await stranger(), f.doc.id, { anchor: anchor('intro'), body: 'x' }, human)).toBeNull();
    expect(await countOpenAnnotations(f.doc.id)).toBe(0);
  });

  it('refuses a document that is not a page', async () => {
    const t = await mintAccountToken('annotations-dataset');
    const made = await createRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { dataset: [{ a: 1 }] } }));
    const { id } = await made.json() as { id: string };
    expect(await createAnnotationFor(identityForUser(t.userId!, t.id), id, { anchor: anchor('intro'), body: 'x' }, human)).toEqual({ refused: 'not_markup' });
  });
});

describe('listing threads', () => {
  it('lists open, resolved or all threads to a reader, and null to someone without access', async () => {
    const f = await fixture();
    const first = await f.comment('First'), second = await f.comment('Second', 'next');
    await actOnAnnotationFor(f.owner, f.doc.id, second.id, { resolve: true }, human);
    expect((await listAnnotationsFor(f.owner, f.doc.id))!.map(w => w.id)).toEqual([first.id]);
    expect((await listAnnotationsFor(f.owner, f.doc.id, { status: 'resolved' }))!.map(w => w.id)).toEqual([second.id]);
    expect((await listAnnotationsFor(f.owner, f.doc.id, { status: 'all' }))!.map(w => w.id).sort()).toEqual([first.id, second.id].sort());
    expect(await listAnnotationsFor(await stranger(), f.doc.id)).toBeNull();
    expect(await listAnnotationsFor(ANONYMOUS_ACTOR, f.doc.id)).toBeNull();
  });

  it('pages roots in creation order with a cursor, and filters by author', async () => {
    const f = await fixture();
    const made = [];
    for (const body of ['a', 'b', 'c']) made.push(await f.comment(body));
    const first = (await listAnnotationPageFor(f.owner, f.doc.id, { status: 'all', limit: 2 }))!;
    expect(first.annotations.map(w => w.id)).toEqual([made[0]!.id, made[1]!.id]);
    expect(first.next).toEqual(expect.any(String));
    const rest = (await listAnnotationPageFor(f.owner, f.doc.id, { status: 'all', limit: 2, after: first.next }))!;
    expect(rest.annotations.map(w => w.id)).toEqual([made[2]!.id]);
    expect(rest.next).toBeUndefined();
    expect((await listAnnotationPageFor(f.owner, f.doc.id, { status: 'all', limit: 5, author: f.owner.userId! }))!.annotations).toHaveLength(3);
    expect((await listAnnotationPageFor(f.owner, f.doc.id, { status: 'all', limit: 5, author: 'usr_nobody' }))!.annotations).toEqual([]);
    expect(await listAnnotationPageFor(await stranger(), f.doc.id, { status: 'all', limit: 5 })).toBeNull();
  });
});

describe('actOnAnnotationFor and countOpenAnnotations', () => {
  it('replies, resolves and reopens, counting only open live threads', async () => {
    const f = await fixture();
    const thread = await f.comment('Question');
    expect(await countOpenAnnotations(f.doc.id)).toBe(1);
    const replied = await actOnAnnotationFor(f.owner, f.doc.id, thread.id, { reply: 'Answer' }, agent);
    expect(replied!.thread.map(c => c.body)).toEqual(['Question', 'Answer']);
    expect(await countOpenAnnotations(f.doc.id)).toBe(1);
    expect((await actOnAnnotationFor(f.owner, f.doc.id, thread.id, { resolve: true }, human))!.status).toBe('resolved');
    expect(await countOpenAnnotations(f.doc.id)).toBe(0);
    expect((await actOnAnnotationFor(f.owner, f.doc.id, thread.id, { reopen: true }, human))!.status).toBe('open');
    expect(await countOpenAnnotations(f.doc.id)).toBe(1);
    expect(await countOpenAnnotations('missing')).toBe(0);
  });

  it('answers null for an unknown thread or a reader without access', async () => {
    const f = await fixture();
    const thread = await f.comment('Question');
    expect(await actOnAnnotationFor(f.owner, f.doc.id, 'ann_missing', { reply: 'x' }, human)).toBeNull();
    expect(await actOnAnnotationFor(await stranger(), f.doc.id, thread.id, { reply: 'x' }, human)).toBeNull();
  });
});

describe('deleteAnnotationFor', () => {
  it('lets the owner delete a thread once, and nobody without access', async () => {
    const f = await fixture();
    const thread = await f.comment('Remove me');
    expect(await deleteAnnotationFor(await stranger(), f.doc.id, thread.id)).toBe(false);
    expect(await deleteAnnotationFor(f.owner, f.doc.id, thread.id)).toBe(true);
    expect(await deleteAnnotationFor(f.owner, f.doc.id, thread.id)).toBe(false);
    expect(await countOpenAnnotations(f.doc.id)).toBe(0);
    expect(await listAnnotationsFor(f.owner, f.doc.id, { status: 'all' })).toEqual([]);
  });
});

describe('the HTTP doors: respondToAnnotationAction, respondToAnnotationEdit, respondToCommentReaction', () => {
  it('answers a reply, and names malformed, contradictory or empty actions', async () => {
    const f = await fixture();
    const thread = await f.comment('Question');
    const ok = await respondToAnnotationAction({ reply: 'Answer' }, f.owner, agent, f.doc.id, thread.id);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Wire).thread).toHaveLength(2);
    expect((await respondToAnnotationAction(null, f.owner, agent, f.doc.id, thread.id)).status).toBe(400);
    for (const body of [{}, { reply: '   ' }, { reply: 1 }, { resolve: true, reopen: true }, { resolve: 'yes' }, { expected_revision: -1, reply: 'x' }, { reply: 'x', attachment_id: 'cim_abc' }, { reply: 'x', attachment_id: 'bad id', edit_id: 'e' }]) {
      const refused = await respondToAnnotationAction(body, f.owner, agent, f.doc.id, thread.id);
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({ error: 'invalid_annotation_action' });
    }
    expect((await respondToAnnotationAction({ reply: 'x' }, f.owner, agent, f.doc.id, 'ann_missing')).status).toBe(404);
  });

  it('refuses a state change against a stale revision, but never a plain reply', async () => {
    const f = await fixture();
    const thread = await f.comment('Question');
    const conflict = await respondToAnnotationAction({ resolve: true, expected_revision: 99 }, f.owner, human, f.doc.id, thread.id);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: 'annotation_conflict', current_revision: expect.any(Number) });
  });

  it('edits only the actor’s own comment, with a uniform 404 otherwise', async () => {
    const f = await fixture();
    const thread = await f.comment('Typo hre');
    const edited = await respondToAnnotationEdit({ body: 'Typo here' }, f.owner, f.doc.id, thread.id);
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as Wire).thread[0]!.body).toBe('Typo here');
    expect((await respondToAnnotationEdit({ body: 'Mine now' }, await stranger(), f.doc.id, thread.id)).status).toBe(404);
    expect((await respondToAnnotationEdit(null, f.owner, f.doc.id, thread.id)).status).toBe(400);
    for (const body of [{}, { body: '  ' }, { body: 'x', expected_revision: 1.5 }]) expect((await respondToAnnotationEdit(body, f.owner, f.doc.id, thread.id)).status).toBe(400);
    const stale = await respondToAnnotationEdit({ body: 'x', expected_revision: 99 }, f.owner, f.doc.id, thread.id);
    expect(stale.status).toBe(409);
  });

  it('sets and clears a thumbs-up for an account, and refuses accountless or malformed reactions', async () => {
    const f = await fixture();
    const thread = await f.comment('Nice');
    const on = await respondToCommentReaction({ kind: 'thumbs_up', active: true }, f.owner, f.doc.id, thread.id, human);
    expect(on.status).toBe(200);
    expect(JSON.stringify(await on.json())).toContain('thumbs_up');
    expect((await respondToCommentReaction({ kind: 'thumbs_up', active: false }, f.owner, f.doc.id, thread.id, human)).status).toBe(200);
    expect((await respondToCommentReaction({ kind: 'thumbs_up', active: true }, ANONYMOUS_ACTOR, f.doc.id, thread.id, human)).status).toBe(403);
    for (const body of [null, {}, { kind: 'heart', active: true }, { kind: 'thumbs_up', active: 'yes' }]) expect((await respondToCommentReaction(body, f.owner, f.doc.id, thread.id, human)).status).toBe(400);
    expect((await respondToCommentReaction({ kind: 'thumbs_up', active: true }, f.owner, f.doc.id, 'ann_missing', human)).status).toBe(404);
  });
});

describe('the artifact wire with annotations', () => {
  async function markup() {
    const t = await mintAccountToken('annotations-markup');
    const row = await createArtifact(t.id, t.userId, { format: 'markup', source: '<p id="a1b2">Unique words here</p>', meta: {}, title: 'Doc', description: null, visibility: 'private' } as never);
    return { t, row, actor: identityForUser(t.userId!, t.id) };
  }

  it('inlines a markup document’s open threads and counts them; other formats carry neither', async () => {
    const m = await markup();
    const open = await createAnnotationFor(m.actor, m.row.id, { body: 'On these', quote: 'Unique words' }, human) as Wire;
    expect(open.id).toMatch(/^ann_/);
    const row = (await getArtifactById(m.row.id))!;
    const wire = await artifactToWireWithAnnotations(row, BASE, m.actor.userId) as { annotations: Wire[]; open_annotations: number };
    expect(wire.open_annotations).toBe(1);
    expect(wire.annotations.map(w => w.id)).toEqual([open.id]);
    expect(await artifactWireFor(row, BASE)).toMatchObject({ open_annotations: 1 });
    const f = await fixture();
    await f.comment('On a page');
    const page = (await getArtifactById(f.doc.id))!;
    const pageWire = await artifactToWireWithAnnotations(page, BASE);
    expect(pageWire).not.toHaveProperty('annotations');
    expect(pageWire).not.toHaveProperty('open_annotations');
    expect(await artifactWireFor(page, BASE)).not.toHaveProperty('open_annotations');
  });

  it('answers a reader’s snapshot with their capabilities, and null without access', async () => {
    const f = await fixture('public');
    const owned = await readArtifactSnapshot(f.owner, f.doc.id, BASE) as { capabilities: Record<string, boolean>; id: string };
    expect(owned).toMatchObject({ id: f.doc.id, capabilities: { read: true, edit: true, delete: true } });
    const reader = await readArtifactSnapshot(await stranger(), f.doc.id, BASE) as { capabilities: Record<string, boolean> } & Record<string, unknown>;
    expect(reader.capabilities).toMatchObject({ read: true, edit: false, delete: false });
    expect(reader).not.toHaveProperty('shares');
    const hidden = await fixture('private');
    expect(await readArtifactSnapshot(await stranger(), hidden.doc.id, BASE)).toBeNull();
  });
});

describe('readCommentChangesFor', () => {
  const read = (actor: Parameters<typeof readCommentChangesFor>[0], id: string, after: string, extra: Partial<Parameters<typeof readCommentChangesFor>[2]> = {}) =>
    readCommentChangesFor(actor, id, { after, limit: 10, waitSeconds: 0, signal: new AbortController().signal, ...extra });

  it('replays from start, resumes from a cursor, and reports writes made with the reading credential as yours', async () => {
    const f = await fixture();
    await f.comment('Before');
    const start = (await read(f.owner, f.doc.id, 'start'))!;
    expect(start.events.map(e => (e as { body?: string }).body)).toEqual(['Before']);
    const now = (await read(f.owner, f.doc.id, 'now'))!;
    expect(now.events).toEqual([]);
    await f.comment('After', 'intro', f.owner, agent);
    const next = (await read(f.owner, f.doc.id, now.next_cursor))!;
    expect(next.events).toHaveLength(1);
    expect(next.events[0]).toMatchObject({ body: 'After', author: { kind: 'agent', you: true } });
    expect(start.events[0]).toMatchObject({ author: { kind: 'human', you: true } });
    expect((await read(f.owner, f.doc.id, next.next_cursor))!.events).toEqual([]);
  });

  it('refuses a cursor from another reader or document, or a malformed one', async () => {
    const f = await fixture('public'), other = await fixture('public');
    const cursor = (await read(f.owner, f.doc.id, 'now'))!.next_cursor;
    await expect(read(f.owner, other.doc.id, cursor)).rejects.toBeInstanceOf(InvalidCommentCursor);
    await expect(read(await stranger(), f.doc.id, cursor)).rejects.toBeInstanceOf(InvalidCommentCursor);
    for (const bad of ['', 'not a cursor!', 'x'.repeat(1025), Buffer.from('{"v":2}').toString('base64url')])
      await expect(read(f.owner, f.doc.id, bad)).rejects.toBeInstanceOf(InvalidCommentCursor);
  });

  it('answers null to a reader without access and pages with has_more', async () => {
    const f = await fixture();
    expect(await read(await stranger(), f.doc.id, 'start')).toBeNull();
    for (const body of ['a', 'b', 'c']) await f.comment(body);
    const page = (await read(f.owner, f.doc.id, 'start', { limit: 2 }))!;
    expect(page.events).toHaveLength(2);
    expect(page.has_more).toBe(true);
  });

  it('caps concurrent waits per account with CommentWaitCapacityError, freeing a slot when a wait ends', async () => {
    const f = await fixture();
    const cursor = (await read(f.owner, f.doc.id, 'now'))!.next_cursor;
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    const waits = controllers.map(c => read(f.owner, f.doc.id, cursor, { waitSeconds: 30, signal: c.signal }).catch((error: unknown) => error));
    await new Promise(resolve => setTimeout(resolve, 100));
    await expect(read(f.owner, f.doc.id, cursor, { waitSeconds: 30 })).rejects.toBeInstanceOf(CommentWaitCapacityError);
    controllers.forEach(c => c.abort(new Error('done')));
    await Promise.all(waits);
    const freed = new AbortController();
    const again = read(f.owner, f.doc.id, cursor, { waitSeconds: 30, signal: freed.signal }).catch((error: unknown) => error);
    await new Promise(resolve => setTimeout(resolve, 50));
    freed.abort(new Error('done'));
    expect(await again).toEqual(new Error('done'));
  });
});

describe('annotationAuthorForRequest', () => {
  const author = (headers: Record<string, string>, remembered?: Parameters<typeof annotationAuthorForRequest>[1]) => annotationAuthorForRequest(new Request(BASE, { headers }), remembered);
  it('labels a declared agent or a branded user agent, falling back to the remembered harness', () => {
    expect(author({ 'user-agent': 'claude-code/1.0' }).kind).toBe('agent');
    expect(author({ 'user-agent': 'node' }, 'codex')).toEqual({ kind: 'agent', label: 'Codex', transport: 'http' });
    expect(author({ 'user-agent': 'node' })).toEqual({ kind: 'agent', label: null, transport: 'http' });
  });

  it('keeps a custom agent name verbatim (trimmed), never granting anything from it', () => {
    expect(author({ [ARTIFACTBIN_AGENT_HEADER]: '  My Bot  ' })).toEqual({ kind: 'agent', label: 'My Bot', transport: 'http' });
    expect(author({ [ARTIFACTBIN_AGENT_HEADER]: 'codex', 'user-agent': 'claude-cli/1.0' })).toEqual({ kind: 'agent', label: 'Codex', transport: 'http' });
    expect(author({ [ARTIFACTBIN_AGENT_HEADER]: '   ', 'user-agent': 'node' }, 'cursor')).toEqual({ kind: 'agent', label: 'Cursor', transport: 'http' });
  });
});
