import {nativeHtml} from './native-html-fixture';
/**
 * THE HOME BOOTSTRAP — GET /api/page/home?part=bootstrap through the REAL handler.
 *
 * One response resolves the effective homepage destination (explicit account preference, explicit
 * Personal, inherited company default, inherited public Personal) and carries what that destination
 * renders: a group's details and its shelf together, or the personal shelf. The browser never walks
 * preference -> group details -> group shelf, and a group homepage never reads the personal shelf.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as homePage } from '@/app/api/page/home/route';
import { GET as deploymentState } from '@/app/api/deployment/route';
import { GET as preferences } from '@/app/api/me/preferences/route';
import { GET as groupDetail } from '@/app/api/groups/[id]/route';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { createUser } from '@/lib/accounts';
import { overrideConfig, resetConfigOverrides } from '@/lib/platform/config';
import { getDb, measureQueries } from '@/lib/platform';
import { createGroup } from '@/lib/groups';
import { admitDeploymentIdentity, setupDeployment } from '@/lib/deployment';
import { mintAccountToken, request, setSession, useAppHarness } from './harness';

useAppHarness();
const signedIn = { id: '', email: '' };
beforeEach(() => { signedIn.id = ''; signedIn.email = ''; setSession(() => (signedIn.id ? { user: { id: signedIn.id, email: signedIn.email } } : null)); });
afterEach(() => resetConfigOverrides());

const bootstrap = (personal = false) => homePage(request(`/api/page/home?part=bootstrap${personal ? '&personal=1' : ''}`));
const read = async (response: Response) => { expect(response.status, await response.clone().text()).toBe(200); return response.json() as Promise<any>; };

async function world() {
  const member = await createUser({ email: 'mxmx_test_home_member@example.com' });
  const outsider = await createUser({ email: 'mxmx_test_home_outsider@example.com' });
  const memberToken = await mintAccountToken('member', member.id);
  const group = await createGroup(member.id, { handle: 'home-team', name: 'Home Team' });
  const publish = async (title: string, destination: object) => {
    const response = await createArtifact(request('/api/artifacts', { method: 'POST', token: memberToken.token, json: { html: nativeHtml(`<h1>${title}</h1>`), title, destination } }));
    expect(response.status, await response.clone().text()).toBe(201);
    return (await response.json()).id as string;
  };
  const personalId = await publish('Personal secret', { type: 'personal' });
  const groupArtifactId = await publish('Team plan', { type: 'group', id: group.id });
  const prefer = async (destination: object) => { await (await getDb()).query('INSERT INTO account_preferences(user_id,default_destination) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET default_destination=EXCLUDED.default_destination', [member.id, JSON.stringify(destination)]); };
  const as = (user: { id: string; email: string | null }) => { signedIn.id = user.id; signedIn.email = user.email ?? ''; };
  return { member, outsider, group, personalId, groupArtifactId, prefer, as };
}

describe('GET /api/page/home?part=bootstrap', () => {
  it('resolves an explicit default group into its details and shelf in one response, without the personal shelf', async () => {
    const w = await world();
    await w.prefer({ type: 'group', id: w.group.id });
    w.as(w.member);
    const body = await read(await bootstrap());
    expect(body).toMatchObject({
      signedIn: true, accountId: w.member.id,
      deployment: { mode: 'public' },
      preferences: { default_destination: { type: 'group', id: w.group.id } },
      destination: { kind: 'group', groupId: w.group.id, detail: { group: { id: w.group.id, handle: 'home-team', role: 'editor' } } },
    });
    expect(body.destination.core.artifacts.map((row: { id: string }) => row.id)).toEqual([w.groupArtifactId]);
    expect(JSON.stringify(body)).not.toContain('Personal secret');
  });

  it('answers in fewer statements than the browser waterfall it replaces, and never reads the personal shelf for a group', async () => {
    const w = await world();
    await w.prefer({ type: 'group', id: w.group.id });
    w.as(w.member);
    const { token } = await mintAccountToken('waterfall', w.member.id);
    const waterfall = {
      deployment: await measureQueries(() => deploymentState(request('/api/deployment'))),
      preferences: await measureQueries(() => preferences(request('/api/me/preferences', { token }))),
      detail: await measureQueries(() => groupDetail(request(`/api/groups/${w.group.id}`, { token }), { params: Promise.resolve({ id: w.group.id }) })),
      groupShelf: await measureQueries(() => homePage(request(`/api/page/home?part=core&groupId=${w.group.id}`))),
      personalShelf: await measureQueries(() => homePage(request('/api/page/home?part=core'))),
    };
    const before = Object.values(waterfall).reduce((sum, run) => sum + run.stats.count, 0);
    const after = await measureQueries(() => bootstrap());
    expect((after.value as Response).status).toBe(200);
    expect((await (after.value as Response).json()).destination).toMatchObject({ kind: 'group', groupId: w.group.id });
    const groupFlow = before - waterfall.personalShelf.stats.count;
    process.stderr.write(`home bootstrap statements: before(full browser flow)=${before} before(without unused personal shelf)=${groupFlow} after=${after.stats.count}\n`);
    expect(after.stats.count).toBeLessThan(before);
    expect(after.stats.count).toBeLessThanOrEqual(groupFlow);
  });

  it('resolves explicit Personal, and recovers Personal with ?personal=1 even when the saved group is gone', async () => {
    const w = await world();
    w.as(w.member);
    await w.prefer({ type: 'personal' });
    const personal = await read(await bootstrap());
    expect(personal.destination.kind).toBe('personal');
    expect(personal.destination.core.artifacts.map((row: { id: string }) => row.id)).toEqual([w.personalId]);
    await w.prefer({ type: 'group', id: w.group.id });
    await (await getDb()).query("UPDATE groups SET deleted_at=now() WHERE id=$1", [w.group.id]);
    expect((await read(await bootstrap())).destination).toEqual({ kind: 'unavailable', groupId: w.group.id });
    const recovered = await read(await bootstrap(true));
    expect(recovered.destination.kind).toBe('personal');
    expect(recovered.destination.core.artifacts.map((row: { id: string }) => row.id)).toEqual([w.personalId]);
  });

  it('inherits Personal on a public deployment and the company default group on a company deployment', async () => {
    const w = await world();
    w.as(w.member);
    expect((await read(await bootstrap())).destination.kind).toBe('personal');
    overrideConfig({}, { APP__DEPLOYMENT_MODE: 'company', APP__DEPLOYMENT_OWNER_EMAIL: w.member.email!, AUTH__INVITE_ONLY: 'false' });
    await admitDeploymentIdentity({ userId: w.member.id, email: w.member.email!, emailVerified: true });
    await setupDeployment(w.member.id, w.group.id);
    const inherited = await read(await bootstrap());
    expect(inherited.deployment).toMatchObject({ mode: 'company', setup_complete: true, default_group: { id: w.group.id } });
    expect(inherited.destination).toMatchObject({ kind: 'group', groupId: w.group.id });
    expect(inherited.destination.core.artifacts.map((row: { id: string }) => row.id)).toEqual([w.groupArtifactId]);
    await w.prefer({ type: 'personal' });
    expect((await read(await bootstrap())).destination.kind).toBe('personal');
  });

  it('shows no group details or artifacts to someone outside the group, or after the group is deleted', async () => {
    const w = await world();
    await (await getDb()).query("INSERT INTO account_preferences(user_id,default_destination) VALUES($1,$2::jsonb)", [w.outsider.id, JSON.stringify({ type: 'group', id: w.group.id })]);
    w.as(w.outsider);
    const refused = await read(await bootstrap());
    expect(refused.destination).toEqual({ kind: 'unavailable', groupId: w.group.id });
    expect(JSON.stringify(refused)).not.toMatch(/Home Team|Team plan|home-team|Personal secret/);
    await (await getDb()).query("UPDATE groups SET deleted_at=now() WHERE id=$1", [w.group.id]);
    w.as(w.member);
    await (await getDb()).query("INSERT INTO account_preferences(user_id,default_destination) VALUES($1,$2::jsonb)", [w.member.id, JSON.stringify({ type: 'group', id: w.group.id })]);
    expect((await read(await bootstrap())).destination).toEqual({ kind: 'unavailable', groupId: w.group.id });
  });

  it('keeps company setup and incomplete-setup recovery: setup without a shelf, Personal on request', async () => {
    const w = await world();
    overrideConfig({}, { APP__DEPLOYMENT_MODE: 'company', APP__DEPLOYMENT_OWNER_EMAIL: w.member.email!, AUTH__INVITE_ONLY: 'false' });
    await admitDeploymentIdentity({ userId: w.member.id, email: w.member.email!, emailVerified: true });
    w.as(w.member);
    const setup = await read(await bootstrap());
    expect(setup.deployment).toMatchObject({ mode: 'company', setup_complete: false, is_owner: true });
    expect(setup.destination).toEqual({ kind: 'setup' });
    const personal = await read(await bootstrap(true));
    expect(personal.destination.kind).toBe('personal');
    expect(personal.destination.core.artifacts.map((row: { id: string }) => row.id)).toEqual([w.personalId]);
  });

  it('tells an anonymous browser only the public deployment state', async () => {
    await world();
    const body = await read(await bootstrap());
    expect(body).toEqual({ signedIn: false, deployment: { mode: 'public', setup_complete: true, is_owner: false, default_group: null } });
  });
});
