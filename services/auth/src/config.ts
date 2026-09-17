import type { OidcProvider } from './auth/human';
import {readEnv} from './env';
const LOGIN_PROVIDER_ENV_NAMES = {
  googleClientId: 'AUTH__GOOGLE_CLIENT_ID',
  googleClientSecret: 'AUTH__GOOGLE_CLIENT_SECRET',
  oidcProviderId: 'AUTH__OIDC_PROVIDER_ID',
  oidcClientId: 'AUTH__OIDC_CLIENT_ID',
  oidcClientSecret: 'AUTH__OIDC_CLIENT_SECRET',
  oidcAuthorizationUrl: 'AUTH__OIDC_AUTHORIZATION_URL',
  oidcTokenUrl: 'AUTH__OIDC_TOKEN_URL',
  oidcUserInfoUrl: 'AUTH__OIDC_USERINFO_URL',
  oidcDiscoveryUrl: 'AUTH__OIDC_DISCOVERY_URL',
} as const;
export interface LoginProviders {
  google?: { clientId: string; clientSecret: string };
  oidc?: OidcProvider;
}

/**
 * THE one reader of the login-provider names: `AUTH__GOOGLE_CLIENT_ID` + `AUTH__GOOGLE_CLIENT_SECRET` (both, or no
 * Google), and `AUTH__OIDC_PROVIDER_ID` with `AUTH__OIDC_{CLIENT_ID,CLIENT_SECRET,AUTHORIZATION_URL,TOKEN_URL,USERINFO_URL,
 * DISCOVERY_URL}` (the id, or no OIDC). Reads through the env audit (`readEnv`) so nothing lands in `unknownNames`. Used
 * by every composition root that stands identity up — the literal reads live nowhere else.
 */
export function loginProvidersOf(source: Record<string, string | undefined>): LoginProviders {
  const googleClientId = readEnv(source, LOGIN_PROVIDER_ENV_NAMES.googleClientId);
  const googleClientSecret = readEnv(source, LOGIN_PROVIDER_ENV_NAMES.googleClientSecret);
  const oidcProviderId = readEnv(source, LOGIN_PROVIDER_ENV_NAMES.oidcProviderId);
  const oidcClientId = readEnv(source, LOGIN_PROVIDER_ENV_NAMES.oidcClientId);
  const oidcClientSecret = readEnv(source, LOGIN_PROVIDER_ENV_NAMES.oidcClientSecret);
  const oidcAuthorizationUrl = readEnv(source, LOGIN_PROVIDER_ENV_NAMES.oidcAuthorizationUrl);
  const oidcTokenUrl = readEnv(source, LOGIN_PROVIDER_ENV_NAMES.oidcTokenUrl);
  const oidcUserInfoUrl = readEnv(source, LOGIN_PROVIDER_ENV_NAMES.oidcUserInfoUrl);
  const oidcDiscoveryUrl = readEnv(source, LOGIN_PROVIDER_ENV_NAMES.oidcDiscoveryUrl);
  return {
    ...(googleClientId && googleClientSecret
      ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } }
      : {}),
    ...(oidcProviderId ? {
      oidc: {
        providerId: oidcProviderId,
        clientId: oidcClientId ?? '',
        clientSecret: oidcClientSecret ?? '',
        authorizationUrl: oidcAuthorizationUrl,
        tokenUrl: oidcTokenUrl,
        userInfoUrl: oidcUserInfoUrl,
        discoveryUrl: oidcDiscoveryUrl,
      },
    } : {}),
  };
}

/**
 * WHICH LOGIN METHODS COULD ACTUALLY COMPLETE A ROUND TRIP — a stricter question than
 * `loginProvidersOf`, which answers "what did the operator name". A host that boots with a named
 * but unfinished method serves a login page whose button dies at the provider, so the one caller
 * that must refuse before serving (the CLI's `teamSettings`) asks this instead. It is derived from
 * `loginProvidersOf`, so the provider names stay read in exactly one place and the env audit
 * (`readEnv`) still sees every one of them.
 *
 * - **mail** needs the key AND a sender. `EMAIL__FROM` is not optional in practice: the composition
 *   falls back to `artifactbin <login@example.com>`, a domain no real provider is verified for, so
 *   the key alone sends nothing.
 * - **google** is already all-or-nothing in `loginProvidersOf`; this only rejects blank values.
 * - **oidc** needs a client id and secret on top of the provider id, plus somewhere to send the
 *   browser: a discovery URL, or all three explicit endpoints. `userInfoUrl` is genuinely required
 *   in the explicit shape because `loginProvidersOf` never supplies a `userInfo` hook, so
 *   `createHumanAuth` sets no `getUserInfo` and Better Auth must fetch the claims itself.
 */
export interface CompleteLoginMethods {
  mail?: { apiKey: string; from: string };
  google?: { clientId: string; clientSecret: string };
  oidc?: OidcProvider;
}
const filled = (value: string | undefined): boolean => (value ?? '').trim().length > 0;
export function completeLoginMethods(source: Record<string, string | undefined>): CompleteLoginMethods {
  const named = loginProvidersOf(source);
  const apiKey = readEnv(source, 'EMAIL__RESEND_API_KEY'), from = readEnv(source, 'EMAIL__FROM');
  const oidc = named.oidc;
  const endpoints = filled(oidc?.discoveryUrl)
    || (filled(oidc?.authorizationUrl) && filled(oidc?.tokenUrl) && filled(oidc?.userInfoUrl));
  return {
    ...(filled(apiKey) && filled(from) ? { mail: { apiKey: apiKey!.trim(), from: from!.trim() } } : {}),
    ...(named.google && filled(named.google.clientId) && filled(named.google.clientSecret) ? { google: named.google } : {}),
    ...(oidc && filled(oidc.providerId) && filled(oidc.clientId) && filled(oidc.clientSecret) && endpoints ? { oidc } : {}),
  };
}

