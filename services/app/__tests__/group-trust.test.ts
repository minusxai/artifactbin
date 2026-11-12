/**
 * A GROUP'S approval of the addresses a page may call (lib/trust/group-trust), through the real
 * /api/groups/<id>/allowed-addresses handler, the consent answer and the served /raw header: a group editor approves an
 * exact connect/img/media origin, and every member of the group and its subgroups is then not asked about it on any page;
 * nobody else is. Script/frame and wildcards stay per page, a personal Never wins, and TRUST__GROUP_APPROVALS=off
 * ignores the rows and refuses the API.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { request, useAppHarness } from './harness';
import { observedRequest } from './conditional-request';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { DELETE as removeRoute, GET as listRoute, POST as allowRoute } from '@/app/api/groups/[id]/allowed-addresses/route';
import { GET as trustRoute, POST as grantRoute } from '@/app/api/trust/route';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { createUser } from '@/lib/accounts';
import { mintAccountToken } from '@/__tests__/harness';
import * as groups from '@/lib/groups';
import { overrideConfig, resetConfigOverrides } from '@/lib/platform/config';
import { getDb } from '@/lib/platform';
import type { Actor } from '@artifactbin/contracts';

useAppHarness();
afterEach(() => resetConfigOverrides());
const API = 'https://api.example.com', IMG = 'https://img.example.com', PLOTLY = 'https://cdn.plot.ly', NEW = 'https://new.example.com';
const page = (connect: string, extra = '') => `<!doctype html><html><head><meta name="csp-connect" content="${connect}">${extra}<title>t</title></head><body><p>x</p></body></html>`;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function person(name: string) {
  const email = `mxmx_test_${name}@example.com`;
  const user = await createUser({ email, name });
  return { id: user.id, email, actor: { credential: 'session', userId: user.id, email, emailVerified: true } as Actor };
}
const join = async (by: string, group: string, who: { id: string; email: string }, role: 'member' | 'admin') => {
  await groups.inviteGroupMember(by, group, who.email, role); await groups.acceptGroupInvitations(who.id, who.email);
};
async function publish(html: string, token?: { token: string }): Promise<string> {
  token ??= await mintAccountToken('gtpublisher');
  const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token.token, json: { html, visibility: 'public' } }));
  expect(made.status, await made.clone().text()).toBe(201);
  return ((await made.json()) as { id: string }).id;
}
const call = (route: typeof allowRoute, group: string, actor: Actor | undefined, json: unknown, extra: { origin?: string; headers?: Record<string, string> } = {}) =>
  route(request(`/api/groups/${group}/allowed-addresses`, { method: route === removeRoute ? 'DELETE' : 'POST', json, origin: extra.origin ?? 'same', ...(actor ? { actor } : {}), ...(extra.headers ? { headers: extra.headers } : {}) }), params(group));
const csp = async (id: string, actor?: Actor) => (await serveArtifact(request(`/a/${id}/raw`, actor ? { actor } : {}), params(id))).headers.get('Content-Security-Policy') ?? '';
const standing = async (id: string, actor?: Actor) => ((await (await trustRoute(request(`/api/trust?artifactId=${id}`, actor ? { actor } : {}))).json()) as { cspRequest: { status: string; denied: boolean; asking: Record<string, string[]>; group?: { eligible: Record<string, string[]>; groups: Array<{ id: string }> } } }).cspRequest;

/** Company ⊃ Team; `admin` created both (their editor), `editor` and `viewer` are direct members of Company, `sub` of Team. */
async function company() {
  const admin = await person('gtadmin'), editor = await person('gteditor'), viewer = await person('gtviewer'), sub = await person('gtsub'), outsider = await person('gtoutsider');
  const top = await groups.createGroup(admin.id, { handle: 'gtcompany', name: 'Company' });
  const team = await groups.createGroup(admin.id, { handle: 'gtteam', name: 'Team', parent_id: top.id });
  await join(admin.id, top.id, editor, 'admin'); await join(admin.id, top.id, viewer, 'member'); await join(admin.id, team.id, sub, 'member');
  return { admin, editor, viewer, sub, outsider, top, team };
}

describe('a group approval', () => {
  it('pre-approves every member and subgroup member on any page, never anyone else, and removal applies on the next response', async () => {
    const { editor, viewer, sub, outsider, top } = await company();
    const id = await publish(page(API, `<meta name="csp-script" content="${PLOTLY}">`));
    const other = await publish(page(`${API} ${NEW}`));
    expect((await standing(id, viewer.actor)).asking.connect).toEqual([API]);

    const allowed = await call(allowRoute, top.id, editor.actor, { connect: [`${API.toUpperCase()}/`], img: [IMG] });
    expect(allowed.status, await allowed.clone().text()).toBe(200);
    expect(((await allowed.json()) as { changed: Record<string, string[]> }).changed).toMatchObject({ connect: [API], img: [IMG] });

    for (const member of [viewer, sub, editor]) {
      expect(await csp(id, member.actor), 'the header carries the approved host').toMatch(/connect-src [^;]*https:\/\/api\.example\.com/);
      expect(await csp(id, member.actor), 'script is never a group\'s').not.toContain(PLOTLY);
      expect(await standing(id, member.actor)).toMatchObject({ status: 'blocked', asking: { connect: [], script: [PLOTLY] } });
    }
    // Another page declaring it, plus a host nobody approved: only the new host is asked.
    expect(await standing(other, sub.actor)).toMatchObject({ status: 'blocked', asking: { connect: [NEW] } });
    expect(await csp(other, sub.actor)).toContain(API);
    for (const stranger of [outsider.actor, undefined]) {
      expect(await csp(id, stranger)).not.toContain(API);
      expect((await standing(id, stranger)).asking.connect).toEqual([API]);
    }

    const removed = await call(removeRoute, top.id, editor.actor, { connect: [API] });
    expect(removed.status).toBe(200);
    const audit = await (await getDb()).query<{ action: string; actor_user_id: string }>('SELECT action, actor_user_id FROM group_audit WHERE group_id = $1 AND action LIKE $2 ORDER BY created_at, id', [top.id, 'addresses_%']);
    expect(audit.rows).toEqual([{ action: 'addresses_allowed', actor_user_id: editor.id }, { action: 'addresses_removed', actor_user_id: editor.id }]);
    expect(await csp(id, viewer.actor)).not.toContain(API);
    const listed = await listRoute(request(`/api/groups/${top.id}/allowed-addresses`, { actor: viewer.actor }), params(top.id));
    expect(((await listed.json()) as { addresses: unknown[] }).addresses).toEqual([expect.objectContaining({ directive: 'img', host: IMG, approved_by: expect.objectContaining({ id: editor.id }) })]);
  });

  it('a page that covers everything through a group is allowed, a republish adding a host asks for that host only, and a personal Never wins', async () => {
    const { editor, viewer, top } = await company();
    const token = await mintAccountToken('gtpublisher');
    const id = await publish(page(API), token);
    await call(allowRoute, top.id, editor.actor, { connect: [API] });
    expect((await standing(id, viewer.actor)).status).toBe('allowed');

    const saved = await putArtifactRoute(await observedRequest(`/api/artifacts/${id}`, { method: 'PUT', token: token.token, json: { html: page(`${API} ${NEW}`) } }), params(id));
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(await standing(id, viewer.actor)).toMatchObject({ status: 'blocked', asking: { connect: [NEW] } });

    const never = await grantRoute(request('/api/trust', { method: 'POST', json: { artifactId: id, grant: 'never' }, origin: 'same', actor: viewer.actor }));
    expect(((await never.json()) as { cspRequest: { denied: boolean } }).cspRequest.denied).toBe(true);
    expect(await csp(id, viewer.actor), 'Never wins over the group').not.toContain(API);
    expect(await csp(id, editor.actor), 'only for the reader who said it').toContain(API);
  });

  it('names the groups a reader could approve for, only for the eligible part of what is still asked', async () => {
    const { admin, editor, viewer, top, team } = await company();
    const mixed = await publish(page(API, `<meta name="csp-script" content="${PLOTLY}"><meta name="csp-img" content="https://*.tiles.example.com">`));
    const scriptOnly = await publish(`<!doctype html><html><head><meta name="csp-script" content="${PLOTLY}"><title>t</title></head><body><p>x</p></body></html>`);
    expect((await standing(mixed, editor.actor)).group).toEqual({ eligible: expect.objectContaining({ connect: [API], img: [], script: [] }), groups: [expect.objectContaining({ id: top.id })] });
    expect((await standing(mixed, admin.actor)).group?.groups.map((g) => g.id).sort()).toEqual([top.id, team.id].sort());
    expect((await standing(mixed, viewer.actor)).group, 'a viewer edits no group').toBeUndefined();
    expect((await standing(scriptOnly, editor.actor)).group, 'nothing a group may approve').toBeUndefined();
  });
});

describe('/api/groups/<id>/allowed-addresses', () => {
  it('lets editors write and members read, and refuses code directives, wildcards, foreign writes and strangers', async () => {
    const { admin, editor, viewer, outsider, top } = await company();
    expect((await call(allowRoute, top.id, admin.actor, { media: ['https://media.example.com'] })).status).toBe(200);
    const refused = async (actor: Actor | undefined, json: unknown, status: number, error: string, extra = {}) => {
      const response = await call(allowRoute, top.id, actor, json, extra);
      expect(response.status, JSON.stringify(json)).toBe(status);
      expect(((await response.json()) as { error: string }).error).toBe(error);
    };
    await refused(viewer.actor, { connect: [API] }, 403, 'forbidden');
    await refused(outsider.actor, { connect: [API] }, 404, 'not_found');
    await refused(editor.actor, { script: [PLOTLY] }, 400, 'directive_not_allowed');
    await refused(editor.actor, { frame: ['https://www.youtube-nocookie.com'] }, 400, 'directive_not_allowed');
    await refused(editor.actor, { style: ['https://fonts.example.com'] }, 400, 'directive_not_allowed');
    await refused(editor.actor, { connect: ['https://*.example.com'] }, 400, 'wildcard_not_allowed');
    await refused(editor.actor, { connect: ['http://plain.example.com'] }, 400, 'invalid_address');
    await refused(editor.actor, { connect: [API] }, 403, 'forbidden', { origin: 'https://evil.example' });
    await refused(editor.actor, { connect: [API] }, 403, 'forbidden', { headers: { 'sec-fetch-site': 'same-site' } });
    const listed = await listRoute(request(`/api/groups/${top.id}/allowed-addresses`, { actor: viewer.actor }), params(top.id));
    expect(((await listed.json()) as { addresses: Array<{ host: string }> }).addresses.map((a) => a.host)).toEqual(['https://media.example.com']);
    expect((await listRoute(request(`/api/groups/${top.id}/allowed-addresses`, { actor: outsider.actor }), params(top.id))).status).toBe(404);
  });

  it('TRUST__GROUP_APPROVALS=off ignores the stored rows, offers nothing and refuses the API; on again, the rows apply', async () => {
    const { editor, viewer, top } = await company();
    const id = await publish(page(API));
    await call(allowRoute, top.id, editor.actor, { connect: [API] });
    overrideConfig({}, { TRUST__GROUP_APPROVALS: 'off' });
    expect(await csp(id, viewer.actor)).not.toContain(API);
    expect((await standing(id, editor.actor)).group).toBeUndefined();
    expect((await call(allowRoute, top.id, editor.actor, { connect: [NEW] })).status).toBe(403);
    expect((await listRoute(request(`/api/groups/${top.id}/allowed-addresses`, { actor: viewer.actor }), params(top.id))).status).toBe(403);
    resetConfigOverrides();
    expect(await csp(id, viewer.actor)).toContain(API);
  });
});
