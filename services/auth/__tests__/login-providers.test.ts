import { afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { loginProvidersOf } from '../src/config';
import { createHumanAuth, type HumanAuth } from '../src/auth/human';

const SECRET = 's'.repeat(32);
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
  const auth = await createHumanAuth({ secret:SECRET,baseURL:'https://identity.example',mail,...loginProvidersOf(source), pglite: db });
  auths.push(auth);
  return auth;
};
const social = (auth: HumanAuth, provider: string) => auth.handler(new Request('https://identity.example/api/auth/sign-in/social', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://identity.example' }, body: JSON.stringify({ provider, callbackURL: '/' }),
}));

describe('loginProvidersOf', () => {
  it('1. reads Google (both names or nothing) and OIDC (by provider id) through the audit — nothing lands in unknownNames', () => {
    expect(loginProvidersOf({})).toEqual({});
    expect(loginProvidersOf({ AUTH__GOOGLE_CLIENT_ID: 'only-id' })).toEqual({});
    expect(loginProvidersOf(GOOGLE)).toEqual({ google: { clientId: 'google-id', clientSecret: 'google-secret' } });
    const oidc = loginProvidersOf(OIDC).oidc!;
    expect(oidc).toMatchObject({ providerId: 'acme', clientId: 'cid', clientSecret: 'sec', authorizationUrl: 'https://idp.example/authorize', tokenUrl: 'https://idp.example/token' });
  });
});

describe('configured human providers', () => {
  it('3. Better Auth offers Google sign-in only when the config carries it', async () => {
    const withGoogle = await social(await bootWith(GOOGLE), 'google');
    expect(withGoogle.status).toBe(200);
    expect(((await withGoogle.json()) as { url: string }).url).toContain('accounts.google.com');
    const without = await social(await bootWith({}), 'google');
    expect(without.status).not.toBe(200);
  }, 30_000);
});

