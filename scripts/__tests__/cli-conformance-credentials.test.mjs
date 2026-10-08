import { afterEach, expect, it, vi } from 'vitest';
import { connectAgent } from '../gates/lib/cli-connection.mjs';
import { createConformanceCredentialProvider, conformanceNonOwnerEmail } from '../gates/lib/cli-conformance.mjs';

afterEach(() => vi.unstubAllGlobals());

it('uses configured inbox credentials for distinct owner and non-owner accounts, then approves the non-owner device', async () => {
  const base = 'https://acceptance.example.test';
  const ownerEmail = 'mxmx_test_owner@inbox.example.test';
  const env = { EVAL_LOGIN_EMAIL: ownerEmail, RESEND_EVAL_API_KEY: 'test-api-key' };
  const acquire = vi.fn(async (_source, options) => ({ email: options.email, token: `driver:${options.email}`, cookie: `session=${options.email}` }));
  const credentialFor = createConformanceCredentialProvider({ base, env, credentialSource: 'inbox-oauth', configuredAcquire: acquire });
  const owner = await credentialFor(ownerEmail);
  const nonOwnerEmail = conformanceNonOwnerEmail(ownerEmail, 'run-42');
  const nonOwner = await credentialFor(nonOwnerEmail);

  expect(nonOwnerEmail).toBe('mxmx_test_nonowner_run-42@inbox.example.test');
  expect(nonOwner.email).not.toBe(owner.email);
  expect(acquire.mock.calls.map(([source, options]) => [source, options.email])).toEqual([
    ['inbox-oauth', ownerEmail],
    ['inbox-oauth', nonOwnerEmail],
  ]);

  const approvedWith = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    if (url.endsWith('/oauth/device')) return Response.json({ device_code: 'device-code', user_code: 'ABCD-EFGH' });
    if (url.endsWith('/oauth/device/approve')) {
      approvedWith.push(options.headers.Cookie);
      return Response.json({ ok: true });
    }
    if (url.endsWith('/oauth/device/token')) return Response.json({ access_token: 'non-owner-agent-token' });
    throw new Error(`unexpected request: ${url}`);
  }));
  expect(await connectAgent(base, { cookie: nonOwner.cookie })).toEqual({ token: 'non-owner-agent-token' });
  expect(approvedWith).toEqual([nonOwner.cookie]);
  expect(approvedWith).not.toContain(owner.cookie);
});

it('keeps local conformance account login on the protected outbox path', async () => {
  const base = 'http://localhost:3030';
  const sink = { lastCode: vi.fn() };
  const configuredAcquire = vi.fn();
  const localSignIn = vi.fn(async (_base, options) => ({ cookie: `local=${options.email}` }));
  const credentialFor = createConformanceCredentialProvider({ base, env: {}, sink, configuredAcquire, localSignIn });
  expect(await credentialFor('mxmx_test_local@example.com')).toEqual({ cookie: 'local=mxmx_test_local@example.com' });
  expect(localSignIn).toHaveBeenCalledWith(base, { sink, email: 'mxmx_test_local@example.com' });
  expect(configuredAcquire).not.toHaveBeenCalled();
});
