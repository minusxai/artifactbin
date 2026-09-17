import { afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { completeLoginMethods, loginProvidersOf } from '../src/config';
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

/**
 * NAMED versus CONFIGURED. `loginProvidersOf` answers what an operator wrote down; this answers
 * whether anyone could finish a login with it — the question a host must refuse on, because a named
 * but unfinished method still renders its button and still dies at the provider.
 */
describe('completeLoginMethods', () => {
  const MAIL = { EMAIL__RESEND_API_KEY: 're_key', EMAIL__FROM: 'Team <team@example.test>' };
  it('2. wants the whole of each method: the mail sender, both Google names, and OIDC with a client and endpoints', () => {
    expect(completeLoginMethods({})).toEqual({});
    // Resend without a sender is the tempting half-setup: `createTeamApplication` falls back to
    // `artifactbin <login@example.com>`, which no provider is verified for.
    expect(completeLoginMethods({ EMAIL__RESEND_API_KEY: 're_key' })).toEqual({});
    expect(completeLoginMethods({ ...MAIL, EMAIL__FROM: '   ' })).toEqual({});
    expect(completeLoginMethods(MAIL).mail).toEqual({ apiKey: 're_key', from: 'Team <team@example.test>' });

    expect(completeLoginMethods({ AUTH__GOOGLE_CLIENT_ID: 'only-id' }).google).toBeUndefined();
    expect(completeLoginMethods(GOOGLE).google).toEqual({ clientId: 'google-id', clientSecret: 'google-secret' });

    // The provider id alone configures nothing; a client without endpoints has nowhere to send the
    // browser; and `userInfoUrl` is required in the explicit shape because `loginProvidersOf` never
    // supplies a `userInfo` hook, so Better Auth has to fetch the claims itself.
    for (const half of [
      { AUTH__OIDC_PROVIDER_ID: 'acme' },
      { ...OIDC, AUTH__OIDC_CLIENT_SECRET: undefined },
      { ...OIDC, AUTH__OIDC_USERINFO_URL: undefined },
      { ...OIDC, AUTH__OIDC_AUTHORIZATION_URL: undefined, AUTH__OIDC_TOKEN_URL: undefined, AUTH__OIDC_USERINFO_URL: undefined },
    ]) expect(completeLoginMethods(half).oidc, JSON.stringify(half)).toBeUndefined();
    expect(completeLoginMethods(OIDC).oidc).toMatchObject({ providerId: 'acme' });
    // Discovery stands in for all three endpoints — human.ts fetches it at init.
    expect(completeLoginMethods({
      AUTH__OIDC_PROVIDER_ID: 'acme', AUTH__OIDC_CLIENT_ID: 'cid', AUTH__OIDC_CLIENT_SECRET: 'sec',
      AUTH__OIDC_DISCOVERY_URL: 'https://idp.example/.well-known/openid-configuration',
    }).oidc).toMatchObject({ providerId: 'acme' });
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

