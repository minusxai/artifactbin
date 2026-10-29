/**
 * TEST-DOMAIN SIGN-IN — disposable accounts for automated runs (the agent evals).
 *
 * A deployment that sets BOTH `TEST_DOMAIN` (e.g. `test.minusx.ai`) and `TEST_DOMAIN_OTP` lets any
 * address whose domain is exactly that one sign in with that fixed code; no mail is sent. Either name
 * unset turns the feature off completely. The code must be 32–128 characters of `[A-Za-z0-9_-]`, the
 * alphabet the skill's `auth.mjs` accepts in a code file; a shorter or odd value refuses to enable the
 * feature rather than accepting a guessable code.
 *
 * The identity service owns the code (services/auth). The app only needs the domain, to mark the
 * accounts it creates for those addresses as test accounts (`users.test_account`) and to keep them
 * away from everyone else.
 */
export interface TestDomainSignIn { domain: string; code: string }

export const TEST_DOMAIN_CODE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/**
 * The feature's settings from the two raw values: `off` when either is unset or empty, `invalid` with
 * a reason that never contains the code, or the normalized setting (domain lowercased).
 */
export function parseTestDomainSignIn(domain: string | undefined, code: string | undefined):
  { state: 'off' } | { state: 'invalid'; reason: string } | { state: 'on'; value: TestDomainSignIn } {
  const name = domain?.trim().toLowerCase() ?? '';
  if (!name || !code) return { state: 'off' };
  if (!HOSTNAME.test(name)) return { state: 'invalid', reason: 'TEST_DOMAIN must be a plain domain name such as test.example.com' };
  if (!TEST_DOMAIN_CODE_PATTERN.test(code)) return { state: 'invalid', reason: 'TEST_DOMAIN_OTP must be 32 to 128 characters of letters, digits, - or _' };
  return { state: 'on', value: { domain: name, code } };
}

/**
 * Is this address AT the test domain — exactly that domain, never a subdomain or a longer name that
 * ends with it (`x@evil-test.example.com`, `x@test.example.com.evil.com`, `x@sub.test.example.com`).
 */
export function isTestDomainEmail(email: string, domain: string): boolean {
  const parts = email.trim().toLowerCase().split('@');
  return parts.length === 2 && parts[0]!.length > 0 && parts[1] === domain.trim().toLowerCase();
}
