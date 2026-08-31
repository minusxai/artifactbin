/**
 * lean-3 seed — ONE reader of the login-provider names.
 *
 * The co-hosted server (server.ts) reads AUTH__GOOGLE_* and AUTH__OIDC_* by hand; the standalone proxy reads neither,
 * so a deployment that boots `runStandalone` silently loses Google/OIDC login. After this phase the proxy's config
 * module owns those reads (`loginProvidersOf`), `loadConfig` carries them, `humanAuthOptionsFor` turns a config into
 * the Better Auth options (`buildDeps` spreads it over its pool, the co-hosted server over its PGLite), and the
 * package root exports the seam. Five pins, all red at handoff.
 */
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { loadConfig, loginProvidersOf } from '../src/config';
import { humanAuthOptionsFor } from '../src/standalone';
import { createHumanAuth, type HumanAuth } from '../src/auth/human';

const SECRET = 's'.repeat(32);
const BASE = { APP__UPSTREAM_URL: 'http://artifactbin-app:3000', CONTRACT__ACTOR_SECRET: SECRET, AUTH__SECRET: SECRET, APP__PUBLIC_BASE_URL: 'https://proxy.example' };
const GOOGLE = { AUTH__GOOGLE_CLIENT_ID: 'google-id', AUTH__GOOGLE_CLIENT_SECRET: 'google-secret' };
const OIDC = {
  AUTH__OIDC_PROVIDER_ID: 'acme', AUTH__OIDC_CLIENT_ID: 'cid', AUTH__OIDC_CLIENT_SECRET: 'sec',
  AUTH__OIDC_AUTHORIZATION_URL: 'https://idp.example/authorize', AUTH__OIDC_TOKEN_URL: 'https://idp.example/token', AUTH__OIDC_USERINFO_URL: 'https://idp.example/userinfo',
};
const mail = { send: async () => {} };
const auths: HumanAuth[] = []; const dbs: PGlite[] = [];
afterAll(async () => { for (const db of dbs) await db.close(); });
const bootWith = async (source: Record<string, string | undefined>): Promise<HumanAuth> => {
  const db = new PGlite(); dbs.push(db);
  const auth = await createHumanAuth({ ...humanAuthOptionsFor(loadConfig({ ...BASE, ...source }), mail), pglite: db });
  auths.push(auth);
  return auth;
};
const social = (auth: HumanAuth, provider: string) => auth.handler(new Request('https://proxy.example/api/auth/sign-in/social', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://proxy.example' }, body: JSON.stringify({ provider, callbackURL: '/' }),
}));

describe('loginProvidersOf / loadConfig', () => {
  it('1. reads Google (both names or nothing) and OIDC (by provider id) through the audit — nothing lands in unknownNames', () => {
    expect(loginProvidersOf({})).toEqual({});
    expect(loginProvidersOf({ AUTH__GOOGLE_CLIENT_ID: 'only-id' })).toEqual({});
    expect(loginProvidersOf(GOOGLE)).toEqual({ google: { clientId: 'google-id', clientSecret: 'google-secret' } });
    const oidc = loginProvidersOf(OIDC).oidc!;
    expect(oidc).toMatchObject({ providerId: 'acme', clientId: 'cid', clientSecret: 'sec', authorizationUrl: 'https://idp.example/authorize', tokenUrl: 'https://idp.example/token' });
    const c = loadConfig({ ...BASE, ...GOOGLE, ...OIDC });
    expect(c.google).toEqual({ clientId: 'google-id', clientSecret: 'google-secret' });
    expect(c.oidc?.providerId).toBe('acme');
    expect(c.unknownNames).toEqual([]);
    expect(loadConfig(BASE)).not.toHaveProperty('google');
  });
});

describe('humanAuthOptionsFor(config, mail)', () => {
  it('2. is the whole of what createHumanAuth needs from config: secret, baseURL, schema, secure, providers, mail', () => {
    const o = humanAuthOptionsFor(loadConfig({ ...BASE, ...GOOGLE, AUTH__SCHEMA: 'identity' }), mail);
    expect(o).toMatchObject({ secret: SECRET, baseURL: 'https://proxy.example', schema: 'identity', secure: true, google: { clientId: 'google-id', clientSecret: 'google-secret' }, mail });
    expect(o).not.toHaveProperty('oidc');
    const local = humanAuthOptionsFor(loadConfig({ APP__UPSTREAM_URL: 'http://a:1', CONTRACT__ACTOR_SECRET: SECRET, APP__PORT: '5613' }), mail);
    expect(local.baseURL).toBe('http://localhost:5613');
    expect(local.secure ?? false).toBe(false);
  });
  it('3. Better Auth offers Google sign-in only when the config carries it', async () => {
    const withGoogle = await social(await bootWith(GOOGLE), 'google');
    expect(withGoogle.status).toBe(200);
    expect(((await withGoogle.json()) as { url: string }).url).toContain('accounts.google.com');
    const without = await social(await bootWith({}), 'google');
    expect(without.status).not.toBe(200);
  }, 30_000);
});

describe('one reader', () => {
  const root = path.resolve(import.meta.dirname, '../../..');
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
  it('4. server.ts no longer reads the provider names itself — it asks loginProvidersOf; buildDeps spreads humanAuthOptionsFor', () => {
    const server = read('server.ts');
    expect(server).not.toMatch(/AUTH__(GOOGLE|OIDC)_/);
    expect(server).toMatch(/loginProvidersOf\(/);
    const standalone = read('services/proxy/src/standalone.ts');
    expect(standalone).toMatch(/\.\.\.humanAuthOptionsFor\(config/);
    expect(read('services/proxy/src/config.ts')).toMatch(/AUTH__GOOGLE_CLIENT_ID|'GOOGLE_CLIENT_ID'/);
  });
  it('5. the package root exports loginProvidersOf and humanAuthOptionsFor', async () => {
    const pkg = await import('../src/index');
    expect(typeof (pkg as Record<string, unknown>).loginProvidersOf).toBe('function');
    expect(typeof (pkg as Record<string, unknown>).humanAuthOptionsFor).toBe('function');
  });
});
