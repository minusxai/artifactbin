/**
 * WHO THE EDITOR'S DOOR ADMITS IS WHO THE HEAD READ ADMITS. The browser editor used to read the whole document again
 * (`GET /api/my/artifacts/:id`, the head read) on every mount to learn whether this browser may write, and drew the
 * "this document is locked" card when it was refused. A seeded editor (solid/editor/ArtifactEditor) now takes its
 * admission from the editor door (`?part=editor`) instead, and an unseeded one (the door refused) still reads the head
 * and draws the card. That swap is only sound if the two never disagree, so this runs both against every state a
 * document can be in for a reader: each must answer the same side of 200, and the refusals are the ones the lock card
 * was drawn for (no session, no share, a commenter or viewer, someone else's private document, a trashed document, a
 * stored shape the server no longer serves).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppHarness, request, setSession, mintAccountToken as mintToken } from '@/__tests__/harness';
import { GET as artifactPage } from '@/app/api/page/artifact/[id]/route';
import { GET as headRead } from '@/app/api/my/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { createUser, claimToken, ensureUsername } from '@/lib/accounts';
import { createGroup } from '@/lib/groups';

const sessionUser = { id: '', email: '' };
const harness = useAppHarness();
beforeEach(() => setSession(() => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null)));
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (user: { id: string; email: string } | null) => { sessionUser.id = user?.id ?? ''; sessionUser.email = user?.email ?? ''; };

const user = async (name: string) => ensureUsername(await createUser({ email: `mxmx_test_${name}@example.com` }));

async function world() {
  const [owner, editor, commenter, viewer, stranger, groupEditor, groupViewer] = await Promise.all(
    ['own', 'edit', 'comment', 'view', 'stranger', 'gedit', 'gview'].map(user));
  const token = await mintToken('admission', owner!.id); await claimToken(owner!.id, token.token);
  const db = await harness.db();
  const make = async (visibility: 'private' | 'public' = 'private') => {
    const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token.token, json: { title: null, markup: '<p id="a">Hi</p>', visibility } }));
    if (made.status !== 201) throw new Error(await made.text());
    return (await made.json() as { id: string }).id;
  };
  const shared = await make();
  for (const [who, role] of [[editor, 'editor'], [commenter, 'commenter'], [viewer, 'viewer']] as const) {
    await db.query('INSERT INTO artifact_shares(artifact_id,email,role,user_id) VALUES($1,$2,$3,$4)', [shared, who!.email, role, who!.id]);
  }
  const group = await createGroup(owner!.id, { handle: 'admission-team', name: 'Admission team' });
  await db.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'editor'),($1,$3,'viewer')", [group.id, groupEditor!.id, groupViewer!.id]);
  const grouped = await make();
  await db.query('UPDATE artifacts SET group_id=$2 WHERE id=$1', [grouped, group.id]);
  const publicViewer = await make('public');
  const publicEditor = await make('public');
  await db.query("UPDATE artifacts SET link_role='editor' WHERE id=$1", [publicEditor]);
  const trashed = await make();
  await db.query('UPDATE artifacts SET deleted_at=now() WHERE id=$1', [trashed]);
  const retired = await make();
  await db.query("UPDATE artifacts SET meta=meta-'dataSyntax' WHERE id=$1", [retired]);
  const privateDoc = await make();
  return { owner: owner!, editor: editor!, commenter: commenter!, viewer: viewer!, stranger: stranger!, groupEditor: groupEditor!, groupViewer: groupViewer!, ids: { shared, grouped, publicViewer, publicEditor, trashed, retired, privateDoc } };
}

describe('the editor door and the head read admit the same readers', () => {
  const shared = harness.shared(world);
  const probe = async (who: { id: string; email: string } | null, id: string) => {
    as(who);
    const door = (await artifactPage(request(`/api/page/artifact/${id}?part=editor`), params(id))).status;
    const head = await headRead(request(`/api/my/artifacts/${id}`), params(id)).then((res) => res.status, () => 500);
    // The admission alone, as an editor seeded earlier asks it again (create-edit-lifecycle `admitted`).
    const probe = (await artifactPage(request(`/api/page/artifact/${id}?part=editor&probe=1`), params(id))).status;
    return { door, head, probe };
  };
  type Who = 'owner' | 'editor' | 'commenter' | 'viewer' | 'stranger' | 'groupEditor' | 'groupViewer' | null;
  const cases: Array<[string, Who, string, boolean]> = [
    ['the owner', 'owner', 'shared', true],
    ['a named editor', 'editor', 'shared', true],
    ['a named commenter', 'commenter', 'shared', false],
    ['a named viewer', 'viewer', 'shared', false],
    ['a stranger to a private document', 'stranger', 'privateDoc', false],
    ['no session at all', null, 'shared', false],
    ['an editor of the group that holds the document', 'groupEditor', 'grouped', true],
    ['a viewer of the group that holds the document', 'groupViewer', 'grouped', false],
    ['a stranger to a public document whose link reads', 'stranger', 'publicViewer', false],
    ['a stranger to a public document whose link edits', 'stranger', 'publicEditor', true],
    ['the owner of a trashed document', 'owner', 'trashed', false],
    ['the owner of a document whose stored shape is no longer served (410)', 'owner', 'retired', false],
  ];
  it.each(cases)('%s', async (_name, who, doc, admitted) => {
    const w = shared();
    const { door, head, probe: again } = await probe(who ? w[who] : null, w.ids[doc as keyof typeof w.ids]);
    if (doc === 'retired') expect(door).toBe(410);
    expect({ door: door === 200, head: head === 200 }).toEqual({ door: admitted, head: admitted });
    // The re-asked admission refuses exactly what the door refuses, with the same status (404, or the 410 of a retired shape).
    expect(again).toBe(door);
  });
});
