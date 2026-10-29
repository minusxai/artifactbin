import type { OidcProvider } from './auth/human';
import {parseTestDomainSignIn, type TestDomainSignIn} from '@artifactbin/contracts';
import {readEnv} from './env';
import type { MailSettings } from './mail';
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

/** The audited owner of outgoing-mail settings. Credentials are never interpolated into errors. */
export function mailSettingsOf(source: Record<string, string | undefined>): MailSettings {
  const apiKey = readEnv(source, 'EMAIL__RESEND_API_KEY')?.trim() || undefined;
  const from = readEnv(source, 'EMAIL__FROM')?.trim() || 'artifactbin <login@example.com>';
  const host = readEnv(source, 'EMAIL__SMTP_HOST')?.trim() || undefined;
  const portValue = readEnv(source, 'EMAIL__SMTP_PORT')?.trim() || undefined;
  const secureValue = readEnv(source, 'EMAIL__SMTP_SECURE')?.trim() || undefined;
  const user = readEnv(source, 'EMAIL__SMTP_USER')?.trim() || undefined;
  // Passwords are opaque: do not silently trim valid leading/trailing spaces.
  const password = readEnv(source, 'EMAIL__SMTP_PASSWORD') || undefined;
  const named = !!(host || portValue || secureValue || user || password);
  if (!named) return { ...(apiKey ? { apiKey } : {}), from };
  if (apiKey) throw new Error('Configure either EMAIL__SMTP_HOST or EMAIL__RESEND_API_KEY, never both.');
  if (!host) throw new Error('EMAIL__SMTP_HOST is required when SMTP settings are present.');
  if (!/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[a-f0-9:]+\])$/i.test(host)) throw new Error('EMAIL__SMTP_HOST must be a hostname or IP address, not a URL.');
  if (secureValue && secureValue !== 'true' && secureValue !== 'false') throw new Error('EMAIL__SMTP_SECURE must be true or false.');
  const secure = secureValue === 'true';
  const port = portValue ? Number(portValue) : secure ? 465 : 587;
  if ((portValue && !/^\d+$/.test(portValue)) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('EMAIL__SMTP_PORT must be an integer from 1 to 65535.');
  if (!!user !== !!password) throw new Error('EMAIL__SMTP_USER and EMAIL__SMTP_PASSWORD must both be set or both be absent.');
  return { from, smtp: { host, port, secure, ...(user && password ? { user, password } : {}) } };
}

/**
 * WHICH LOGIN METHODS COULD ACTUALLY COMPLETE A ROUND TRIP — a stricter question than
 * `loginProvidersOf`, which answers "what did the operator name". A host that boots with a named
 * but unfinished method serves a login page whose button dies at the provider, so the one caller
 * that must refuse before serving (the CLI's `teamSettings`) asks this instead. It is derived from
 * `loginProvidersOf`, so the provider names stay read in exactly one place and the env audit
 * (`readEnv`) still sees every one of them.
 *
 * - **mail** needs a completed Resend or SMTP transport AND a sender. `EMAIL__FROM` is not optional in practice: the composition
 *   falls back to `artifactbin <login@example.com>`, a domain no real provider is verified for, so
 *   the key alone sends nothing.
 * - **google** is already all-or-nothing in `loginProvidersOf`; this only rejects blank values.
 * - **oidc** needs a client id and secret on top of the provider id, plus somewhere to send the
 *   browser: a discovery URL, or all three explicit endpoints. `userInfoUrl` is genuinely required
 *   in the explicit shape because `loginProvidersOf` never supplies a `userInfo` hook, so
 *   `createHumanAuth` sets no `getUserInfo` and Better Auth must fetch the claims itself.
 */
export interface CompleteLoginMethods {
  mail?: MailSettings;
  google?: { clientId: string; clientSecret: string };
  oidc?: OidcProvider;
}
const filled = (value: string | undefined): boolean => (value ?? '').trim().length > 0;
export function completeLoginMethods(source: Record<string, string | undefined>): CompleteLoginMethods {
  const named = loginProvidersOf(source);
  const mail = mailSettingsOf(source), from = readEnv(source, 'EMAIL__FROM');
  const oidc = named.oidc;
  const endpoints = filled(oidc?.discoveryUrl)
    || (filled(oidc?.authorizationUrl) && filled(oidc?.tokenUrl) && filled(oidc?.userInfoUrl));
  return {
    ...(filled(from) && (mail.apiKey || mail.smtp) ? { mail } : {}),
    ...(named.google && filled(named.google.clientId) && filled(named.google.clientSecret) ? { google: named.google } : {}),
    ...(oidc && filled(oidc.providerId) && filled(oidc.clientId) && filled(oidc.clientSecret) && endpoints ? { oidc } : {}),
  };
}


export interface AdmissionPolicy {inviteOnly:boolean;matches:(email:string)=>boolean}
/** Email rules are comma-separated exact addresses or simple * globs, never regex. */
export function admissionPolicyOf(source:Record<string,string|undefined>,read:typeof readEnv=readEnv):AdmissionPolicy {
 const value=read(source,'AUTH__INVITE_ONLY')??'true';
 if(value!=='true'&&value!=='false')throw new Error('AUTH__INVITE_ONLY must be true or false.');
 const patterns=(read(source,'AUTH__ALLOWED_EMAIL_PATTERNS')??'*').split(',').map(p=>p.trim().toLowerCase());
 if(patterns.some(p=>!p||!/^[a-z0-9._+@*\-]+$/.test(p)||(p!=='*'&&(!p.includes('@')||p.split('@').length!==2||p.split('@').some(part=>!part)))))throw new Error('AUTH__ALLOWED_EMAIL_PATTERNS must contain nonempty email addresses or simple email globs.');
 const rules=patterns.map(p=>new RegExp('^'+p.split('*').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$'));
 return {inviteOnly:value==='true',matches:email=>rules.some(rule=>rule.test(email.trim().toLowerCase()))};
}

/**
 * `TEST_DOMAIN` + `TEST_DOMAIN_OTP` (contracts `parseTestDomainSignIn`): disposable accounts at one
 * exact domain sign in with one fixed code and receive no mail. Both names, or nothing. An invalid
 * pair leaves the feature OFF and says why once, never echoing the code. Unnamespaced on purpose:
 * the operator, the eval harness and CI secrets share these two names.
 */
export function testDomainSignInOf(source:Record<string,string|undefined>,warn:(line:string)=>void=console.warn):TestDomainSignIn|undefined {
 const parsed=parseTestDomainSignIn(readEnv(source,'TEST_DOMAIN'),readEnv(source,'TEST_DOMAIN_OTP'));
 if(parsed.state==='invalid')warn(`[auth] test-domain sign-in disabled: ${parsed.reason}`);
 return parsed.state==='on'?parsed.value:undefined;
}
