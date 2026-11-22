/**
 * Trusted-issuer sign-in (`POST /api/auth/trusted-sign-in`): a signed token from a configured issuer, submitted from
 * its origin, signs the person in (by email address, or by a handle the issuer owns), creating the person, the group (with its fixed tenancy) and the membership; every
 * other token, origin or identity conflict is refused without a session.
 */
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assemble, ensureTable } from '@artifactbin/utils';
import type { TransactionalQueryable } from '@artifactbin/contracts/identity-module';
import { createHumanAuth, sessionStoreOf, type HumanAuth } from '../src/index';
import { authParts } from '../src/parts';
import { createIdentityStore } from '../src/identity-store';
import { identityViewStatements } from '../src/identity-store/views';
import { IDENTITY_TABLES } from '../src/identity-store/schema';
import { testAuthOptions } from './helpers';

const BASE = 'http://localhost:4795';
const EMBEDDER = 'https://embedder.example';
const AUDIENCE = 'app-a';
const keys = generateKeyPairSync('ed25519');
const stranger = generateKeyPairSync('ed25519');
const otherKeys = generateKeyPairSync('ed25519');

let pg: PGlite;
let auth: HumanAuth;
let db: TransactionalQueryable;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;

const issuers = (extra: Record<string, unknown> = {}) => JSON.stringify([{
  issuer: 'issuer-a', audience: AUDIENCE, origins: [EMBEDDER], publicJwk: keys.publicKey.export({ format: 'jwk' }), parentGroup: 'parent_team', ...extra,
}]);
const twoIssuers = () => JSON.stringify([...JSON.parse(issuers()), {
  issuer: 'issuer-b', audience: AUDIENCE, origins: [EMBEDDER], publicJwk: otherKeys.publicKey.export({ format: 'jwk' }), parentGroup: 'parent_team',
}]);
const app = async (env: Record<string, string | undefined> = { TRUSTED_SIGNIN__ISSUERS: issuers() }) => assemble(authParts(await testAuthOptions({
  env, sessions: sessionStoreOf(auth), identityTransactions: db,
})));

let counter = 0;
const now = () => Math.floor(Date.now() / 1000);
function token(claims: Record<string, unknown> = {}, o: { key?: KeyObject; header?: Record<string, unknown> } = {}): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = part(o.header ?? { alg: 'EdDSA', typ: 'JWT' });
  const body = part({ iss: 'issuer-a', aud: AUDIENCE, iat: now(), exp: now() + 120, jti: `jti-${++counter}`, sub: 'user_1', group: 'group_1', tenancy_id: 'tenant-1', ...claims });
  return `${head}.${body}.${sign(null, Buffer.from(`${head}.${body}`), o.key ?? keys.privateKey).toString('base64url')}`;
}
const post = async (target: Awaited<ReturnType<typeof app>>, form: Record<string, string>, headers: Record<string, string> = { origin: EMBEDDER }) =>
  target.request(`${BASE}/api/auth/trusted-sign-in`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(form).toString() });
const cookieOf = (response: Response) => response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
async function refused(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error });
  expect(response.headers.getSetCookie()).toEqual([]);
}

beforeAll(async () => {
  pg = new PGlite();
  auth = await createHumanAuth({ pglite: pg, schema: 'auth', secret: 'trusted-sign-in-secret'.padEnd(32, '0'), baseURL: BASE, mail: { send: async () => {} } });
  await ensureTable({ query: (sql: string, params?: unknown[]) => pg.query(sql, params) as never }, IDENTITY_TABLES, { schema: 'auth' });
  await pg.query(`INSERT INTO auth.group_hierarchy(id,revision) VALUES('installation',0)`);
  await pg.query(`INSERT INTO auth.groups(id,handle,name,created_by) VALUES('grp_parent','parent_team','Parent','usr_admin'),('grp_plain','plain_team','Plain','usr_admin')`);
  await pg.query(`INSERT INTO auth.users(id,email,username) VALUES('usr_taken','taken@example.com','taken_user')`);
  await pg.exec(`CREATE SCHEMA company_app;
    CREATE TABLE company_app.identity_settings(id text PRIMARY KEY, deployment_mode text);
    CREATE TABLE company_app.deployment_state(id text PRIMARY KEY, owner_user_id text, default_group_id text, setup_complete boolean);
    CREATE SCHEMA identity;
    CREATE TABLE company_app.deployment_members(user_id text PRIMARY KEY);
    CREATE TABLE public.identity_settings (LIKE company_app.identity_settings);
    CREATE TABLE public.deployment_state (LIKE company_app.deployment_state);
    INSERT INTO public.identity_settings VALUES('installation','public');
    INSERT INTO company_app.identity_settings VALUES('installation','company');`);
  const userView=identityViewStatements({auth:'auth',app:'company_app',read:'identity'}).find(sql=>sql.startsWith('CREATE OR REPLACE VIEW identity.users '))!;
  await pg.exec(userView);
  db = {
    query: (sql, params) => pg.query(sql, params) as never,
    transaction: fn => pg.transaction(tx => fn({ query: (sql, params) => tx.query(sql, params) as never })),
  };
});
afterAll(async () => { await pg.close(); });

describe('trusted-issuer sign-in', () => {
  it('shares a person, group and replay record across two issuer sites with their own keys', async () => {
    const second = 'https://second.example';
    const [first] = JSON.parse(issuers());
    const site = {...first, origins:[second], publicJwk:otherKeys.publicKey.export({format:'jwk'})};
    const configured = (overrides = {}) => app({TRUSTED_SIGNIN__ISSUERS:JSON.stringify([first, {...site, ...overrides}])});
    const target = await configured();
    const claims = {sub:'shared_reader', group:'shared_group'};
    const a = await post(target, {token:token({...claims,jti:'shared-once'})});
    expect(a.status).toBe(303);
    await refused(await post(target,{token:token(claims)}, {origin:second}),401,'invalid_token');
    await refused(await post(target,{token:token({...claims,jti:'shared-once'},{key:otherKeys.privateKey})},{origin:second}),401,'replayed_token');
    const b = await post(target,{token:token(claims,{key:otherKeys.privateKey})},{origin:second});
    expect(b.status).toBe(303);
    expect(b.headers.get('location')).toBe(a.headers.get('location'));
    const person = async (response:Response) => (await auth.sessions.resolve(new Request(BASE,{headers:{cookie:cookieOf(response)}})))!.userId;
    expect(await person(b)).toBe(await person(a));
    await expect(configured({parentGroup:'other_parent'})).rejects.toThrow(/parentGroup/);
    await expect(configured({audience:'other-audience'})).rejects.toThrow(/audience/);
  });
  it('restores a renamed legacy handle only to its bound issuer and person', async () => {
    const target = await app({TRUSTED_SIGNIN__ISSUERS:twoIssuers()});
    const claims = {sub:'legacy_reader',group:'legacy_team'};
    const first = await post(target,{token:token(claims)});
    const person = (await auth.sessions.resolve(new Request(BASE,{headers:{cookie:cookieOf(first)}})))!;
    await pg.query("UPDATE auth.users SET username='past_rename' WHERE id=$1",[person.userId]);
    await pg.query("UPDATE auth.handle_reservations SET handle='past_rename' WHERE subject_id=$1",[person.userId]);
    await pg.query("INSERT INTO auth.users(id,username) VALUES('usr_holder','legacy_reader')");
    await refused(await post(target,{token:token(claims)}),403,'subject_conflict');
    await pg.query("DELETE FROM auth.users WHERE id='usr_holder'");
    await refused(await post(target,{token:token({...claims,iss:'issuer-b'},{key:otherKeys.privateKey})}),403,'subject_conflict');
    const returning = await post(target,{token:token(claims)});
    expect(returning.status).toBe(303);
    expect((await auth.sessions.resolve(new Request(BASE,{headers:{cookie:cookieOf(returning)}})))?.userId).toBe(person.userId);
    expect(await rows('SELECT username FROM auth.users WHERE id=$1',[person.userId])).toEqual([{username:claims.sub}]);
  });
  it('allows the company owner to bootstrap one root, then requires a parent; public groups may detach', async () => {
    const store = createIdentityStore({db, authSchema:'auth', appSchema:'company_app'});
    await pg.query("INSERT INTO auth.users(id,email) VALUES ('usr_head','head@example.com')");
    await pg.query("INSERT INTO company_app.deployment_state VALUES('company','usr_head',null,false)");
    const create=(handle:string,parentId?:string)=>store.createGroup({actorId:'usr_head',handle,name:handle,parentId});
    const root=(await create('bootstrap_root')).group;
    await expect(create('extra_root')).rejects.toMatchObject({code:'company_parent_required'});
    await pg.query("UPDATE company_app.deployment_state SET default_group_id=$1,setup_complete=true WHERE id='company'",[root.id]);
    const child=(await create('company_child',root.id)).group;
    await expect(store.setGroupParent({actorId:'usr_head',groupId:child.id,parentId:null})).rejects.toMatchObject({code:'company_parent_required'});
    await expect(create('extra_root')).rejects.toMatchObject({code:'company_parent_required'});
    await pg.query("UPDATE company_app.identity_settings SET deployment_mode='public'");
    await expect(create('public_root')).resolves.toMatchObject({group:{parent_id:null}});
    await expect(store.setGroupParent({actorId:'usr_head',groupId:child.id,parentId:null})).resolves.toMatchObject({changed:true,parent_id:null});
    await pg.query("UPDATE company_app.identity_settings SET deployment_mode='company'");
    await pg.query("DELETE FROM company_app.deployment_state");
  });
  it('puts each newly provisioned group under the company root, including when the default is a subgroup', async () => {
    const target = await app({TRUSTED_SIGNIN__ISSUERS:issuers({parentGroup:undefined}), APP__SCHEMA:'company_app'});
    await pg.query("INSERT INTO auth.groups(id,handle,name,created_by,parent_id) VALUES('grp_default','default_team','Default','usr_admin','grp_parent')");
    await pg.query("INSERT INTO company_app.deployment_state VALUES('company','usr_admin','grp_parent',true)");
    for (const [group, defaultGroup] of [['root_default','grp_parent'],['nested_default','grp_default']]) {
      await pg.query("UPDATE company_app.deployment_state SET default_group_id=$1 WHERE id='company'", [defaultGroup]);
      const response=await post(target,{token:token({sub:'company_reader',group})});
      expect(response.status).toBe(303);
      expect(await rows(`SELECT g.handle FROM identity.users u JOIN auth.groups g ON g.id=u.default_group_id
        WHERE u.username='company_reader'`)).toEqual([{handle:group}]);
      expect(await rows('SELECT parent_id FROM auth.groups WHERE handle=$1',[group])).toEqual([{parent_id:'grp_parent'}]);
      expect(await rows(`SELECT g.handle FROM auth.group_members m JOIN auth.groups g ON g.id=m.group_id
        JOIN auth.users u ON u.id=m.user_id WHERE u.username='company_reader'`)).toEqual([{handle:group}]);
    }
  });
  it('uses the configured issuer parent when the company default belongs to a different root', async () => {
    await pg.query(`INSERT INTO company_app.deployment_state VALUES('company','usr_admin','grp_plain',true)
      ON CONFLICT (id) DO UPDATE SET default_group_id=EXCLUDED.default_group_id,setup_complete=true`);
    const target = await app({TRUSTED_SIGNIN__ISSUERS:issuers({parentGroup:'parent_team'}), APP__SCHEMA:'company_app',TRUSTED_SIGNIN__JOIN_COMPANY_ROOT:'true'});
    const claims = {sub:'partner_reader',group:'partner_group'};
    const first = await post(target,{token:token(claims)});
    expect(first.status).toBe(303);
    expect(await rows('SELECT parent_id FROM auth.groups WHERE handle=$1',[claims.group])).toEqual([{parent_id:'grp_parent'}]);
    const memberships = () => rows(`SELECT g.handle,m.role FROM auth.group_members m JOIN auth.groups g ON g.id=m.group_id
      JOIN auth.users u ON u.id=m.user_id WHERE u.username=$1 ORDER BY g.handle`,[claims.sub]);
    expect(await memberships()).toEqual([{handle:'partner_group',role:'member'},{handle:'plain_team',role:'member'}]);
    await pg.query("UPDATE auth.group_members SET role='editor' WHERE group_id='grp_plain' AND user_id=(SELECT id FROM auth.users WHERE username=$1)",[claims.sub]);
    const denied = assemble(authParts(await testAuthOptions({env:{TRUSTED_SIGNIN__ISSUERS:issuers(),APP__SCHEMA:'company_app',TRUSTED_SIGNIN__JOIN_COMPANY_ROOT:'true'},
      sessions:sessionStoreOf(auth),identityTransactions:db,admitIdentity:async()=>false})));
    await refused(await post(denied,{token:token({...claims,group:'refused_group'})}),403,'deployment_admission_required');
    expect(await rows("SELECT id FROM auth.groups WHERE handle='refused_group'")).toEqual([]);
    expect(await memberships()).toEqual([{handle:'partner_group',role:'member'},{handle:'plain_team',role:'editor'}]);
    const returning = await post(target,{token:token({...claims,group:'replacement_group'})});
    expect(returning.status).toBe(303);
    expect(await memberships()).toEqual([{handle:'plain_team',role:'editor'},{handle:'replacement_group',role:'member'}]);
  });
  it('signs the person in, creating the person, the group under its parent with its tenancy, and the membership', async () => {
    const target = await app({TRUSTED_SIGNIN__ISSUERS:issuers(),TRUSTED_SIGNIN__JOIN_COMPANY_ROOT:'true'});
    const response = await post(target, { token: token(), callbackUrl: '/conversations?embed=1' });
    expect(response.status).toBe(303);
    const session = await auth.sessions.resolve(new Request(BASE, { headers: { cookie: cookieOf(response) } }));
    expect(session).toMatchObject({ email: 'user_1@issuer-a.trusted-issuer.invalid', emailVerified: true });
    // Not remembered: the session cookie ends with the browser, and the server expiry is one day, never extended.
    const sessionCookie = response.headers.getSetCookie().find((c) => /session_token=/.test(c))!;
    expect(sessionCookie).not.toMatch(/max-age|expires/i);
    const [stored] = await rows<{ expiresAt: Date }>(`SELECT "expiresAt" FROM auth.session WHERE "userId"=$1`, [session!.userId]);
    expect(new Date(stored!.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 86_400_000 + 5_000);
    const [person] = await rows<{ id: string; username: string; welcome_pending: boolean; name: string }>(`SELECT id,username,welcome_pending,name FROM auth.users WHERE id=$1`, [session!.userId]);
    // Without a name claim, a new handle person is named by their handle.
    expect(person).toMatchObject({ username: 'user_1', welcome_pending: false, name: 'user_1' });
    expect(await rows(`SELECT name FROM auth."user" WHERE id=$1`, [person!.id])).toEqual([{ name: 'user_1' }]);
    expect(await rows(`SELECT "providerId","accountId" FROM auth.account WHERE "userId"=$1`, [person!.id])).toEqual([{ providerId: 'trusted:issuer-a', accountId: 'user_1' }]);
    const [group] = await rows<{ id: string }>(`SELECT id,parent_id,trusted_issuer,tenancy_id FROM auth.groups WHERE handle='group_1'`);
    expect(group).toMatchObject({ parent_id: 'grp_parent', trusted_issuer: 'issuer-a', tenancy_id: 'tenant-1' });
    expect(response.headers.get('location')).toBe(`/conversations?embed=1&group=${group!.id}`);
    expect(await rows('SELECT group_id FROM auth.group_members WHERE user_id=$1',[person!.id])).toEqual([{group_id:group!.id}]);
    expect(await rows(`SELECT user_id,role FROM auth.group_members WHERE group_id=$1`, [group!.id])).toEqual([{ user_id: person!.id, role: 'member' }]);
    // The same person again (a new token): the same account and group, no second row.
    const again = await post(target, { token: token() });
    expect(again.status).toBe(303);
    expect(again.headers.get('location')).toBe(`/?group=${group!.id}`);
    expect((await auth.sessions.resolve(new Request(BASE, { headers: { cookie: cookieOf(again) } })))?.userId).toBe(person!.id);
    expect(await rows(`SELECT 1 FROM auth.users WHERE username='user_1'`)).toHaveLength(1);
    // A second person of the same group joins it.
    expect((await post(target, { token: token({ sub: 'user_2' }) })).status).toBe(303);
    expect(await rows(`SELECT 1 FROM auth.group_members WHERE group_id=$1`, [group!.id])).toHaveLength(2);
  });

  it('leaves the person only in the group of their latest token, and keeps other issuers\' and plain groups', async () => {
    const target = await app();
    const first = await post(target, { token: token({ sub: 'user_9', group: 'group_9a', tenancy_id: 'tenant-9a' }) });
    const [person] = await rows<{ id: string }>(`SELECT id FROM auth.users WHERE username='user_9'`);
    await pg.query(`INSERT INTO auth.group_members(group_id,user_id,role) VALUES('grp_plain',$1,'member')`, [person!.id]);
    const second = await post(target, { token: token({ sub: 'user_9', group: 'group_9b', tenancy_id: 'tenant-9b' }) });
    expect([first.status, second.status]).toEqual([303, 303]);
    const held = await rows<{ handle: string }>(`SELECT g.handle FROM auth.group_members m JOIN auth.groups g ON g.id=m.group_id WHERE m.user_id=$1 ORDER BY 1`, [person!.id]);
    expect(held.map(r => r.handle)).toEqual(['group_9b', 'plain_team']);
    const [b] = await rows<{ id: string }>(`SELECT id FROM auth.groups WHERE handle='group_9b'`);
    expect(second.headers.get('location')).toBe(`/?group=${b!.id}`);
  });

  it('refuses a bad signature, another algorithm, the wrong audience, an expired or too long-lived token, and a replay', async () => {
    const target = await app();
    await refused(await post(target, { token: token({}, { key: stranger.privateKey }) }), 401, 'invalid_token');
    await refused(await post(target, { token: token({}, { header: { alg: 'HS256' } }) }), 401, 'invalid_token');
    await refused(await post(target, { token: token({ aud: 'another-app' }) }), 401, 'invalid_token');
    await refused(await post(target, { token: token({ iat: now() - 400, exp: now() - 10 }) }), 401, 'invalid_token');
    await refused(await post(target, { token: token({ exp: now() + 600 }) }), 401, 'invalid_token');
    await refused(await post(target, { token: token({ iat: undefined }) }), 401, 'invalid_token');
    await refused(await post(target, { token: token({ iss: 'issuer-b' }) }), 401, 'unknown_issuer');
    await refused(await post(target, { token: 'not.a.token' }), 401, 'invalid_token');
    const once = token({ sub: 'user_3' });
    expect((await post(target, { token: once })).status).toBe(303);
    await refused(await post(target, { token: once }), 401, 'replayed_token');
  });

  it('refuses another origin or none, and burns no token id doing so', async () => {
    const target = await app();
    const valid = token({ sub: 'user_4' });
    await refused(await post(target, { token: valid }, { origin: 'https://elsewhere.example' }), 403, 'forbidden_origin');
    await refused(await post(target, { token: valid }, { origin: BASE }), 403, 'forbidden_origin');
    await refused(await post(target, { token: valid }, {}), 403, 'forbidden_origin');
    expect((await post(target, { token: valid })).status).toBe(303);
  });

  it('refreshes only the bound group tenancy on each successful sign-in', async () => {
    const target = await app({ TRUSTED_SIGNIN__ISSUERS: twoIssuers() });
    const claims = { sub: 'reader_one', group: 'host_team', tenancy_id: 'first' };
    const sign = (tenancy_id: string) => post(target, { token: token({ ...claims, tenancy_id }) });
    expect((await sign('first')).status).toBe(303);
    await pg.query("UPDATE auth.groups SET name='Custom', description='Existing settings' WHERE handle='host_team'");
    const snapshot = () => rows("SELECT * FROM auth.groups WHERE handle='host_team'");
    const [before] = await snapshot();
    expect((await sign('second')).status).toBe(303);
    await refused(await post(target, { token: token({ ...claims, sub:'other_reader', iss:'issuer-b' }, { key:otherKeys.privateKey }) }), 403, 'group_conflict');
    await refused(await post(target, { token: token(claims, { key:stranger.privateKey }) }), 401, 'invalid_token');
    await refused(await post(target, { token: token({ ...claims, sub:'taken_user' }) }), 403, 'subject_conflict');
    const denied = assemble(authParts(await testAuthOptions({ env:{TRUSTED_SIGNIN__ISSUERS:issuers()},
      sessions:sessionStoreOf(auth), identityTransactions:db, admitIdentity:async()=>false })));
    await refused(await post(denied, { token:token(claims) }), 403, 'deployment_admission_required');
    expect(await snapshot()).toEqual([{ ...before, tenancy_id: 'second' }]);
    const concurrent = await Promise.all([sign('third'), sign('fourth')]);
    expect(concurrent.map(response => response.status)).toEqual([303,303]);
    const [after] = await snapshot();
    expect(['third','fourth']).toContain(after!.tenancy_id);
    expect(after).toEqual({ ...before, tenancy_id: after!.tenancy_id });
  });

  it('refuses handles it did not create', async () => {
    const target = await app();
    await refused(await post(target, { token: token({ sub: 'user_5', group: 'plain_team' }) }), 403, 'group_conflict');
    await refused(await post(target, { token: token({ sub: 'user_5', group: 'parent_team' }) }), 403, 'group_conflict');
    await refused(await post(target, { token: token({ sub: 'taken_user', group: 'group_9' }) }), 403, 'subject_conflict');
    // A group handle that is a person's handle is not a group to join.
    await refused(await post(target, { token: token({ sub: 'user_5', group: 'taken_user' }) }), 403, 'group_conflict');
    await refused(await post(target, { token: token({ sub: 'Not A Handle' }) }), 401, 'invalid_claims');
    // Nothing of the refused sign-ins was written.
    expect(await rows(`SELECT 1 FROM auth.users WHERE username='user_5'`)).toEqual([]);
    expect(await rows(`SELECT 1 FROM auth.groups WHERE handle='group_9'`)).toEqual([]);
  });

  it('signs an email subject in as the person with that address, created as an email sign-in would', async () => {
    const target = await app();
    const response = await post(target, { token: token({ sub: ' Ada.Person@Example.COM ', group: 'group_e1', tenancy_id: 'tenant-e1' }) });
    expect(response.status).toBe(303);
    const session = await auth.sessions.resolve(new Request(BASE, { headers: { cookie: cookieOf(response) } }));
    expect(session).toMatchObject({ email: 'ada.person@example.com', emailVerified: true });
    const [person] = await rows<{ id: string; username: string; email: string; name: string | null; welcome_pending: boolean }>(
      `SELECT id,username,email,name,welcome_pending FROM auth.users WHERE id=$1`, [session!.userId]);
    expect(person).toMatchObject({ email: 'ada.person@example.com', name: null, welcome_pending: false });
    expect(person!.username).toMatch(/^ada_person_[a-z0-9]{4}$/);
    expect(await rows(`SELECT email,"emailVerified" FROM auth."user" WHERE id=$1`, [person!.id])).toEqual([{ email: 'ada.person@example.com', emailVerified: true }]);
    // Keyed by the address alone: no issuer account row, and the handle's reservation is the email-derived one.
    expect(await rows(`SELECT 1 FROM auth.account WHERE "userId"=$1`, [person!.id])).toEqual([]);
    expect(await rows(`SELECT handle FROM auth.handle_reservations WHERE subject_id=$1`, [person!.id])).toEqual([{ handle: person!.username }]);
    const [group] = await rows<{ id: string }>(`SELECT id,trusted_issuer,tenancy_id FROM auth.groups WHERE handle='group_e1'`);
    expect(group).toMatchObject({ trusted_issuer: 'issuer-a', tenancy_id: 'tenant-e1' });
    expect(await rows(`SELECT user_id,role FROM auth.group_members WHERE group_id=$1`, [group!.id])).toEqual([{ user_id: person!.id, role: 'member' }]);
    // Again: the same person, no second row, the handle kept.
    const again = await post(target, { token: token({ sub: 'ada.person@example.com', group: 'group_e1', tenancy_id: 'tenant-e1' }) });
    expect((await auth.sessions.resolve(new Request(BASE, { headers: { cookie: cookieOf(again) } })))?.userId).toBe(person!.id);
    expect(await rows(`SELECT username FROM auth.users WHERE email='ada.person@example.com'`)).toEqual([{ username: person!.username }]);
  });

  it('reuses the account of an address that signed up by email, and an app row with no sign-in yet', async () => {
    const target = await app();
    await pg.query(`INSERT INTO auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES('usr_signed','','signed@example.com',true,now(),now())`);
    await pg.query(`INSERT INTO auth.users(id,email,username,welcome_pending) VALUES('usr_signed','signed@example.com','signed_ab12',true)`);
    const response = await post(target, { token: token({ sub: 'Signed@Example.com', group: 'group_e2', tenancy_id: 'tenant-e2' }) });
    expect(response.status).toBe(303);
    expect((await auth.sessions.resolve(new Request(BASE, { headers: { cookie: cookieOf(response) } })))?.userId).toBe('usr_signed');
    // The existing person is joined, not changed.
    expect(await rows(`SELECT username,welcome_pending FROM auth.users WHERE email='signed@example.com'`)).toEqual([{ username: 'signed_ab12', welcome_pending: true }]);
    expect(await rows(`SELECT 1 FROM auth."user" WHERE email='signed@example.com'`)).toHaveLength(1);
    const [group] = await rows<{ id: string }>(`SELECT id FROM auth.groups WHERE handle='group_e2'`);
    expect(await rows(`SELECT user_id FROM auth.group_members WHERE group_id=$1`, [group!.id])).toEqual([{ user_id: 'usr_signed' }]);
    // An app row without a Better Auth row (`taken@example.com`): the sign-in row is written under the same id.
    await pg.query("UPDATE auth.users SET name='Existing name' WHERE id='usr_taken'");
    const taken = await post(target, { token: token({ name: 'From host', sub: 'taken@example.com', group: 'group_e2', tenancy_id: 'tenant-e2' }) });
    expect((await auth.sessions.resolve(new Request(BASE, { headers: { cookie: cookieOf(taken) } })))?.userId).toBe('usr_taken');
    expect(await rows(`SELECT u.username,u.name,a.name AS auth_name FROM auth.users u JOIN auth."user" a USING (id) WHERE id='usr_taken'`))
      .toEqual([{ username: 'taken_user', name: 'Existing name', auth_name: 'Existing name' }]);
    // Rows naming two different people for one address are refused.
    await pg.query(`INSERT INTO auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES('usr_split_a','','split@example.com',true,now(),now())`);
    await pg.query(`INSERT INTO auth.users(id,email) VALUES('usr_split_b','split@example.com')`);
    await refused(await post(target, { token: token({ sub: 'split@example.com', group: 'group_e2', tenancy_id: 'tenant-e2' }) }), 403, 'subject_conflict');
  });

  it('lets two issuers sign the same address in, each only moving the person between its own groups', async () => {
    const target = await app({ TRUSTED_SIGNIN__ISSUERS: twoIssuers() });
    const sub = 'both@example.com';
    expect((await post(target, { token: token({ sub, group: 'group_a1', tenancy_id: 'tenant-a1' }) })).status).toBe(303);
    expect((await post(target, { token: token({ iss: 'issuer-b', sub, group: 'group_b1', tenancy_id: 'tenant-b1' }, { key: otherKeys.privateKey }) })).status).toBe(303);
    const people = await rows<{ id: string }>(`SELECT id FROM auth.users WHERE email=$1`, [sub]);
    expect(people).toHaveLength(1);
    const held = async () => (await rows<{ handle: string }>(`SELECT g.handle FROM auth.group_members m JOIN auth.groups g ON g.id=m.group_id WHERE m.user_id=$1 ORDER BY 1`, [people[0]!.id])).map(r => r.handle);
    expect(await held()).toEqual(['group_a1', 'group_b1']);
    // Issuer A moves the person to another of its groups: issuer B's membership stays.
    expect((await post(target, { token: token({ sub, group: 'group_a2', tenancy_id: 'tenant-a2' }) })).status).toBe(303);
    expect(await held()).toEqual(['group_a2', 'group_b1']);
    // A group stays its creator's: issuer B may not join issuer A's.
    await refused(await post(target, { token: token({ iss: 'issuer-b', sub, group: 'group_a2', tenancy_id: 'tenant-a2' }, { key: otherKeys.privateKey }) }), 403, 'group_conflict');
  });

  it('refuses a malformed or reserved address, so no subject names an issuer\'s handle person', async () => {
    const target = await app();
    for (const sub of ['user_1@issuer-a.trusted-issuer.invalid', 'x@example.invalid', 'not@an@address', '@example.com', 'a b@example.com', 'x@localhost', `${'a'.repeat(65)}@example.com`])
      await refused(await post(target, { token: token({ sub, group: 'group_e3' }) }), 401, 'invalid_claims');
    expect(await rows(`SELECT 1 FROM auth.groups WHERE handle='group_e3'`)).toEqual([]);
  });

  it.each(['named_reader', 'named@example.com'])('refreshes only supplied names for %s after admission', async sub => {
    const target = await app();
    const group = sub.includes('@') ? 'named_email_team' : 'named_handle_team';
    const claims = { sub, group };
    const names = () => rows(`SELECT u.id, u.username, u.email, u.name, a.name AS auth_name, g.id AS group_id, g.name AS group_name
      FROM auth.groups g JOIN auth.group_members m ON m.group_id=g.id JOIN auth.users u ON u.id=m.user_id
      JOIN auth."user" a ON a.id=u.id WHERE g.handle=$1`, [group]);
    const first = {name:'River', group_name:'Sample team'};
    expect((await post(target, {token:token({...claims, ...first})})).status).toBe(303);
    const [before] = await names();
    expect(before).toMatchObject({...first, auth_name:'River'});
    for (const patch of [{name:'Robin'}, {group_name:'Renamed team'}, {}])
      expect((await post(target, {token:token({...claims, ...patch})})).status).toBe(303);
    const denied = assemble(authParts(await testAuthOptions({env:{TRUSTED_SIGNIN__ISSUERS:issuers()},
      sessions:sessionStoreOf(auth), identityTransactions:db, admitIdentity:async()=>false})));
    await refused(await post(denied, {token:token({...claims, ...first})}), 403, 'deployment_admission_required');
    const expected = sub.includes('@') ? 'River' : 'Robin';
    expect(await names()).toEqual([{...before, name:expected, auth_name:expected, group_name:'Renamed team'}]);
  });

  it('preserves a personal name across both hosts and fills an empty email name once', async () => {
    const target = await app({ TRUSTED_SIGNIN__ISSUERS: twoIssuers() });
    for (const [id, initial] of [['named_account', 'Chosen Self'], ['empty_account', '']] as const) {
      const sub = id + '@example.com';
      await pg.query(`INSERT INTO auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())`,[id,initial,sub]);
      await pg.query('INSERT INTO auth.users(id,email,name) VALUES($1,$2,$3)',[id,sub,initial]);
      const names = () => rows('SELECT u.name, a.name AS auth_name FROM auth.users u JOIN auth."user" a ON a.id=u.id WHERE u.id=$1',[id]);
      expect((await post(target,{token:token({sub, group:'name_group_a', name:'From A'})})).status).toBe(303);
      expect(await names()).toEqual([{name:initial || 'From A',auth_name:initial || 'From A'}]);
      expect((await post(target,{token:token({iss:'issuer-b',sub,group:'name_group_b',name:'From B'},{key:otherKeys.privateKey})})).status).toBe(303);
      expect(await names()).toEqual([{name:initial || 'From A',auth_name:initial || 'From A'}]);
    }
  });

  it('keeps callbackUrl on this origin', async () => {
    const target = await app();
    for (const callbackUrl of ['//elsewhere.example/x', 'https://elsewhere.example/x', '/\\elsewhere.example', 'javascript:alert(1)', '/a/..//elsewhere.example', '/.//elsewhere.example'])
      expect((await post(target, { token: token(), callbackUrl })).headers.get('location')).toMatch(/^\/\?group=grp_\w+$/);
    expect((await post(target, { token: token(), callbackUrl: '/a/b?c=1#d' })).headers.get('location')).toMatch(/^\/a\/b\?c=1&group=grp_\w+#d$/);
  });

  it('refuses a missing parent group, and is off without a configured issuer', async () => {
    await refused(await post(await app({ TRUSTED_SIGNIN__ISSUERS: issuers({ parentGroup: 'no_such_team' }) }), { token: token({ sub: 'user_6', group: 'group_6' }) }), 503, 'parent_group_missing');
    expect(await rows(`SELECT 1 FROM auth.users WHERE username='user_6'`)).toEqual([]);
    await refused(await post(await app({}), { token: token() }), 404, 'not_found');
  });

  it('never routes the server-only session door', async () => {
    const target = await app();
    const [person] = await rows<{ id: string }>(`SELECT id FROM auth.users WHERE username='user_1'`);
    for (const path of ['/api/auth/trusted-session', '/api/auth/trustedSession']) {
      const response = await target.request(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ userId: person!.id }) });
      expect(response.status).toBe(404);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });

  it('refuses a malformed issuer setting at mount, naming the setting', async () => {
    await expect(app({ TRUSTED_SIGNIN__ISSUERS: '{' })).rejects.toThrow(/TRUSTED_SIGNIN__ISSUERS/);
    await expect(app({ TRUSTED_SIGNIN__ISSUERS: issuers({ publicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'AA', d: 'secret' } }) })).rejects.toThrow(/publicJwk/);
  });
});
