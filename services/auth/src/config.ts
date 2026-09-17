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

