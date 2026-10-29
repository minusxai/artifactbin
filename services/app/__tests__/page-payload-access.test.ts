import {nativeHtml} from './native-html-fixture';
import { describe, expect, it } from 'vitest';
import { useAppHarness, request, setSession, mintAccountToken } from './harness';
import { identityForUser, createUser } from '@/lib/accounts';
import { createGroup, setAccountPreferences, setGroupMember } from '@/lib/groups';
import { getArtifactById, updateSharingFor } from '@/lib/artifacts';
import { POST as publish } from '@/app/api/artifacts/route';
import { GET as pageRoute } from '@/app/api/page/artifact/[id]/route';
import { GET as membersRoute } from '@/app/api/my/artifacts/[id]/members/route';
import { GET as annotationsRoute, POST as createCommentRoute } from '@/app/api/my/artifacts/[id]/annotations/route';
import { artifactPageAnswer } from '@/lib/document-serving';
import { pagesSite } from '@/lib/http';

useAppHarness();

/**
 * WHO IS REFUSED WHAT ON THE ARTIFACT PAGE'S READ DOORS — the page payload (both doors), `/members` and `/annotations`.
 *
 * These pin the OUTCOME (status and body) of every refusal for a signed-in non-member and for nobody, over a private,
 * an unlisted-link and a group-owned document, so a faster way of deciding access (a header-only row read, one role
 * computation per request) can never change who is let in or what a refusal says. The literals were recorded from the
 * code before that change.
 */
const OWNER_EMAIL = 'mxmx_test_payload_access_owner@example.com';
const STRANGER_EMAIL = 'mxmx_test_payload_access_stranger@example.com';
const MEMBER_EMAIL = 'mxmx_test_payload_access_member@example.com';

const NOT_FOUND = { status: 404, body: { error: 'not_found' } };
const MEMBERSHIP_REFUSED = { status: 404, body: { error: 'membership_refused', detail: 'Artifact not found' } };

interface Seen { status: number; body: Record<string, unknown> }
async function seen(response: Response): Promise<Seen> { return { status: response.status, body: await response.json() as Record<string, unknown> }; }

async function world() {
  const owner = await createUser({ email: OWNER_EMAIL });
  const token = await mintAccountToken('owner', owner.id);
  const stranger = await createUser({ email: STRANGER_EMAIL });
  const member = await createUser({ email: MEMBER_EMAIL });
  const group = await createGroup(owner.id, { handle: 'payload-access', name: 'Payload access' });
  await setGroupMember(owner.id, group.id, member.id, 'viewer');
  const make = async (visibility: 'private' | 'unlisted', grouped: boolean) => {
    await setAccountPreferences(owner.id, grouped ? { type: 'group', id: group.id } : { type: 'personal' });
    const response = await publish(request('/api/artifacts', { method: 'POST', token: token.token, json: { visibility, html: nativeHtml('<h1 id="t">Hello</h1><p data-af-id="p">Body</p>'), ...(grouped ? {} : { destination: { type: 'personal' } }) } }));
    expect(response.status).toBe(201);
    return (await response.json() as { id: string }).id;
  };
  const docs = {
    privatePersonal: await make('private', false),
    unlistedPersonal: await make('unlisted', false),
    privateGroup: await make('private', true),
    unlistedGroup: await make('unlisted', true),
  };
  return { owner, stranger, member, docs };
}
type World = Awaited<ReturnType<typeof world>>;

const as = (who: { id: string } | null, email: string | null) => setSession(who ? { user: { id: who.id, email, emailVerified: true } } as never : null);
const page = (id: string) => pageRoute(request(`/api/page/artifact/${id}`), { params: Promise.resolve({ id }) });
const nodesPart = (id: string) => pageRoute(request(`/api/page/artifact/${id}?part=nodes`), { params: Promise.resolve({ id }) });
const pageInFrame = (id: string) => artifactPageAnswer(request(`/api/page/artifact/${id}`), id, { pages: pagesSite() });
const members = (id: string) => membersRoute(request(`/api/my/artifacts/${id}/members`), { params: Promise.resolve({ id }) });
const comment = async (id: string) => {
  const row = (await getArtifactById(id))!;
  return createCommentRoute(request(`/api/my/artifacts/${id}/annotations`, { method: 'POST', json: { anchor: { kind: 'html-node', v: 1, revision: String(row.version), nodeId: 'p', quote: '' }, edit_id: row.edit_id, body: 'A reader may not post' } }), { params: Promise.resolve({ id }) });
};
const READABLE_COMMENTS = { status: 200, body: { annotations: [], next_cursor: null } };
const annotations = (id: string) => annotationsRoute(request(`/api/my/artifacts/${id}/annotations`), { params: Promise.resolve({ id }) });

/** The three doors, as the status and (for a refusal) body each answers. */
async function doors(id: string) {
  const framed = await pageInFrame(id);
  return {
    page: await seen(await page(id)),
    // The tree the page relays to its frame is read by exactly those the page is (it was part of the page before it was a part).
    nodes: await seen(await nodesPart(id)),
    framed: { status: framed.status, body: framed.body as Record<string, unknown> },
    members: await seen(await members(id)),
    annotations: await seen(await annotations(id)),
  };
}
const refusedEverywhere = (r: Awaited<ReturnType<typeof doors>>) => ({ page: r.page, nodes: r.nodes, framed: r.framed, members: r.members, annotations: r.annotations });

describe('a private document refuses everyone who is not named', () => {
  it.each([['a signed-in non-member', 'privatePersonal'], ['a signed-in non-member of its group', 'privateGroup']] as const)('%s on %s gets the uniform refusals', async (_who, kind) => {
    const w = await world();
    as(w.stranger, STRANGER_EMAIL);
    expect(refusedEverywhere(await doors(w.docs[kind]))).toEqual({ page: NOT_FOUND, nodes: NOT_FOUND, framed: NOT_FOUND, members: MEMBERSHIP_REFUSED, annotations: NOT_FOUND });
  });

  it.each(['privatePersonal', 'privateGroup'] as const)('nobody gets uniform read refusals on private %s, including annotations', async (kind) => {
    const w = await world();
    as(null, null);
    const r = await doors(w.docs[kind]);
    expect(r.page).toEqual(NOT_FOUND);
    expect(r.nodes).toEqual(NOT_FOUND);
    expect(r.framed).toEqual(NOT_FOUND);
    expect(r.members).toEqual(MEMBERSHIP_REFUSED);
    expect(r.annotations).toEqual(NOT_FOUND);
  });

  it('a document that does not exist is refused exactly like a private one', async () => {
    await world();
    as(null, null);
    const r = await doors('doesnotexist');
    expect(refusedEverywhere(r)).toMatchObject({ page: NOT_FOUND, nodes: NOT_FOUND, framed: NOT_FOUND, members: MEMBERSHIP_REFUSED, annotations: NOT_FOUND });
  });
});

describe('unlisted links admit conversation reads while keeping writes role-gated', () => {
  it.each(['unlistedPersonal', 'unlistedGroup'] as const)('a signed-in non-member reads %s and its comments as a viewer', async (kind) => {
    const w = await world();
    as(w.stranger, STRANGER_EMAIL);
    const r = await doors(w.docs[kind]);
    expect(r.page.status).toBe(200);
    expect(r.page.body.role).toBe('viewer');
    expect(r.nodes.status).toBe(200);
    expect(r.framed.status).toBe(200);
    expect(r.members.status).toBe(200);
    expect(r.members.body).toMatchObject({ self: null, canManage: false, canInvite: false });
    expect(r.annotations).toEqual(READABLE_COMMENTS);
    expect((await comment(w.docs[kind])).status).toBe(404);
  });

  it.each(['unlistedPersonal', 'unlistedGroup'] as const)('nobody reads %s and its comments, while posting requires sign-in', async (kind) => {
    const w = await world();
    as(null, null);
    const r = await doors(w.docs[kind]);
    expect(r.page.status).toBe(200);
    expect(r.page.body.role).toBe('viewer');
    expect(r.members.status).toBe(200);
    expect(r.members.body).toMatchObject({ self: null, canManage: false, canInvite: false });
    expect(r.annotations).toEqual(READABLE_COMMENTS);
    expect((await comment(w.docs[kind])).status).toBe(401);
  });
});

describe('membership of the owner and the owning group is what lets a reader in', () => {
  it('a group viewer reads the group private document and may not comment on it', async () => {
    const w = await world();
    as(w.member, MEMBER_EMAIL);
    const r = await doors(w.docs.privateGroup);
    expect(r.page.status).toBe(200);
    expect(r.page.body.role).toBe('viewer');
    expect(r.members.status).toBe(200);
    expect(r.annotations).toEqual(READABLE_COMMENTS);
    expect((await comment(w.docs.privateGroup)).status).toBe(404);
  });

  it('the owner sees the owner page of their private document', async () => {
    const w = await world();
    as(w.owner, OWNER_EMAIL);
    const r = await doors(w.docs.privatePersonal);
    expect(r.page.status).toBe(200);
    expect(r.page.body.role).toBe('owner');
    expect((r.page.body.surface as { hasInvitedUsers: boolean }).hasInvitedUsers).toBe(false);
    expect(r.members.body).toMatchObject({ canManage: true });
    expect(r.annotations.status).toBe(200);
  });
});

describe('a named share is honoured while it exists and refused on the very next request once revoked', () => {
  const share = (w: World, role: 'viewer' | 'commenter' | 'editor' | null) =>
    updateSharingFor(identityForUser(w.owner.id, ''), w.docs.privatePersonal, { shares: role ? [{ email: STRANGER_EMAIL, role }] : [] });

  it('a commenter share reads, lists comments, and loses all three doors when revoked', async () => {
    const w = await world();
    as(w.stranger, STRANGER_EMAIL);
    expect((await doors(w.docs.privatePersonal)).page).toEqual(NOT_FOUND);
    await share(w, 'commenter');
    const granted = await doors(w.docs.privatePersonal);
    expect(granted.page.status).toBe(200);
    expect(granted.page.body.role).toBe('commenter');
    expect(granted.nodes.status).toBe(200);
    expect(granted.framed.status).toBe(200);
    expect(granted.members.status).toBe(200);
    expect(granted.annotations).toEqual({ status: 200, body: { annotations: [], next_cursor: null } });
    await share(w, null);
    expect(refusedEverywhere(await doors(w.docs.privatePersonal))).toEqual({ page: NOT_FOUND, nodes: NOT_FOUND, framed: NOT_FOUND, members: MEMBERSHIP_REFUSED, annotations: NOT_FOUND });
  });

  it('a viewer share reads comments, cannot post, and loses read access when revoked', async () => {
    const w = await world();
    as(w.stranger, STRANGER_EMAIL);
    await share(w, 'viewer');
    const granted = await doors(w.docs.privatePersonal);
    expect(granted.page.body.role).toBe('viewer');
    expect(granted.members.status).toBe(200);
    expect(granted.annotations).toEqual(READABLE_COMMENTS);
    expect((await comment(w.docs.privatePersonal)).status).toBe(404);
    await share(w, null);
    expect(refusedEverywhere(await doors(w.docs.privatePersonal))).toEqual({ page: NOT_FOUND, nodes: NOT_FOUND, framed: NOT_FOUND, members: MEMBERSHIP_REFUSED, annotations: NOT_FOUND });
    expect((await comment(w.docs.privatePersonal)).status).toBe(404);
  });

  it('the owner page reports invited users only while a share exists', async () => {
    const w = await world();
    as(w.owner, OWNER_EMAIL);
    const surfaceOf = async () => (await page(w.docs.privatePersonal).then(seen)).body.surface as { hasInvitedUsers: boolean };
    expect((await surfaceOf()).hasInvitedUsers).toBe(false);
    await share(w, 'viewer');
    expect((await surfaceOf()).hasInvitedUsers).toBe(true);
    await share(w, null);
    expect((await surfaceOf()).hasInvitedUsers).toBe(false);
  });
});
