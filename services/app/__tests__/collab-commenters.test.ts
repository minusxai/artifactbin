/**
 * A SHARE CARRIES A ROLE — and the third role is COMMENTER: a named person who
 * may read the document and annotate it (open threads, reply, resolve), and
 * may NOT edit, PUT, revert, delete, share or move. "Read / write / comment"
 * was the ask from the start; annotations (#121) arrived without the role.
 *
 * Editors may annotate too — a person who may change the text may certainly
 * comment on it — and a plain viewer may not: "anyone may read this" has never
 * meant "anyone may write on it".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as editsRoute } from '@/app/api/artifacts/[id]/edits/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as getSharingRoute, PUT as putSharingRoute } from '@/app/api/my/artifacts/[id]/sharing/route';
import { actOnAnnotationFor, createAnnotationFor, listAnnotationsFor } from '@/lib/annotations';
import { parseShareEntries } from '@/lib/artifact-wire';
import { canReadArtifact, effectiveRole as roleFor, getArtifactById } from '@/lib/artifacts';


import { SHARE_ROLES, SHARE_ROLE_LABEL } from '@/lib/share-roles';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null),
}));
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const jreq = (path: string, method: string, body?: unknown, token?: string) =>
  new Request(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const asSession = (u: { id: string; email: string }) => { sessionUser.id = u.id; sessionUser.email = u.email; };
const human = { kind: 'human' as const, label: null, transport: 'browser' as const };

beforeEach(async () => {
  sessionUser.id = ''; sessionUser.email = '';
});

async function world() {
  const owner = await createUser({ email: 'mxmx_test_owner@example.com' });
  const to = await mintToken('owner'); await claimToken(owner.id, to.token);
  const commenter = await createUser({ email: 'mxmx_test_commenter@example.com' });
  const tc = await mintToken('commenter'); await claimToken(commenter.id, tc.token);
  const viewer = await createUser({ email: 'mxmx_test_viewer@example.com' });
  const tv = await mintToken('viewer'); await claimToken(viewer.id, tv.token);
  const editor = await createUser({ email: 'mxmx_test_editor@example.com' });
  const te = await mintToken('editor'); await claimToken(editor.id, te.token);
  const res = await createArtifactRoute(jreq('/api/artifacts', 'POST', { markup: '<div><p>hello</p></div>', visibility: 'private' }, to.token));
  const doc = await res.json();
  asSession(owner);
  const put = await putSharingRoute(jreq(`/api/my/artifacts/${doc.id}/sharing`, 'PUT', { shares: [
    { email: commenter.email, role: 'commenter' }, { email: viewer.email, role: 'viewer' }, { email: editor.email, role: 'editor' },
  ] }), params({ id: doc.id }));
  expect(put.status, await put.clone().text()).toBe(200);
  const row = (await getArtifactById(doc.id))!;
  return { owner, to, commenter, tc, viewer, tv, editor, te, doc, row };
}

describe('the commenter role', () => {
  it('is a share role the vocabulary and the parser know', () => {
    expect(SHARE_ROLES).toContain('commenter');
    expect(SHARE_ROLE_LABEL.commenter).toBe('can comment');
    expect(parseShareEntries([{ email: 'a@example.com', role: 'commenter' }])).toEqual([{ email: 'a@example.com', role: 'commenter' }]);
  });

  it('is stored, listed back, and decided by effectiveRole', async () => {
    const w = await world();
    const listed = await (await getSharingRoute(jreq(`/api/my/artifacts/${w.doc.id}/sharing`, 'GET'), params({ id: w.doc.id }))).json();
    expect(listed.shares.find((s: { email: string }) => s.email === w.commenter.email).role).toBe('commenter');
    expect(await roleFor(w.row, { userId: w.commenter.id, tokenId: w.tc.id })).toBe('commenter');
    expect(await roleFor(w.row, { userId: w.editor.id, tokenId: w.te.id })).toBe('editor');
    expect(await roleFor(w.row, { userId: w.viewer.id, tokenId: w.tv.id })).toBe('viewer');
  });

  it('may READ a private document, like any share', async () => {
    const w = await world();
    expect(await canReadArtifact(w.row, { userId: w.commenter.id, email: null })).toBe(true);
  });

  it('may open a thread, reply, and resolve — and so may an editor; a viewer may not', async () => {
    const w = await world();
    const input = { bodyPath: '0', baseEditId: w.row.edit_id, body: 'is this right?' };
    const opened = await createAnnotationFor({ tokenId: w.tc.id, userId: w.commenter.id }, w.doc.id, input, human);
    expect(opened && 'id' in opened, JSON.stringify(opened)).toBe(true);
    const id = (opened as { id: string }).id;
    const reply = await actOnAnnotationFor({ tokenId: w.tc.id, userId: w.commenter.id }, w.doc.id, id, { reply: 'still wondering' }, human);
    expect(reply && 'id' in reply).toBe(true);
    expect((await listAnnotationsFor({ tokenId: w.tc.id, userId: w.commenter.id }, w.doc.id))?.length).toBe(1);

    const head = (await getArtifactById(w.doc.id))!;
    const byEditor = await createAnnotationFor({ tokenId: w.te.id, userId: w.editor.id }, w.doc.id, { ...input, baseEditId: head.edit_id }, human);
    expect(byEditor && 'id' in byEditor, 'an editor may comment').toBe(true);

    const byViewer = await createAnnotationFor({ tokenId: w.tv.id, userId: w.viewer.id }, w.doc.id, { ...input, baseEditId: head.edit_id }, human);
    expect(byViewer, 'a viewer is refused with the uniform miss').toBeNull();
    expect(await listAnnotationsFor({ tokenId: w.tv.id, userId: w.viewer.id }, w.doc.id)).toBeNull();
  });

  it('may NOT edit, replace, or delete — every write door is the uniform 404', async () => {
    const w = await world();
    const edit = await editsRoute(jreq(`/api/artifacts/${w.doc.id}/edits`, 'POST', { edit_id: w.row.edit_id, source: '<div><p>changed</p></div>' }, w.tc.token), params({ id: w.doc.id }));
    expect(edit.status).toBe(404);
    const put = await putArtifactRoute(jreq(`/api/artifacts/${w.doc.id}`, 'PUT', { markup: '<div><p>changed</p></div>' }, w.tc.token), params({ id: w.doc.id }));
    expect(put.status).toBe(404);
    expect((await getArtifactById(w.doc.id))!.version).toBe(1);
  });
});
