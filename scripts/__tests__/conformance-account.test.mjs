import { expect, it, vi } from 'vitest';
import { connectConformanceNonOwner } from '../gates/lib/conformance-account.mjs';

it('production private-access checks authenticate a different email through the configured inbox', async () => {
  const acquireCredential = vi.fn(async (_source, { email }) => ({ token: `test-token-for-${email}` }));
  const connectAgent = vi.fn(() => { throw new Error('Production has no local outbox'); });
  const env = { EVAL_LOGIN_EMAIL: 'mxmx_test_rollout_123@inbox.example', RESEND_EVAL_API_KEY: 'test-key' };
  const other = await connectConformanceNonOwner({ base: 'https://host.example', accountEmail: env.EVAL_LOGIN_EMAIL, stamp: '123', credentialSource: 'inbox-oauth', env }, { acquireCredential, connectAgent });
  expect(acquireCredential).toHaveBeenCalledWith('inbox-oauth', { base: 'https://host.example', env, email: 'mxmx_test_conformance_other_123@inbox.example', localOutbox: undefined });
  expect(other.token).not.toBe(`test-token-for-${env.EVAL_LOGIN_EMAIL}`);
  expect(connectAgent).not.toHaveBeenCalled();
});

it('local private-access checks keep using an independently approved account', async () => {
  const connectAgent = vi.fn(async () => ({ token: 'test-local-other' }));
  const acquireCredential = vi.fn();
  const other = await connectConformanceNonOwner({ base: 'http://localhost:3030', accountEmail: 'mxmx_test_owner@example.com', stamp: 'local', env: {} }, { acquireCredential, connectAgent });
  expect(other.token).toBe('test-local-other');
  expect(connectAgent).toHaveBeenCalledWith('http://localhost:3030');
  expect(acquireCredential).not.toHaveBeenCalled();
});

it('refuses to run the non-owner check as the owner', async () => {
  const acquireCredential = vi.fn();
  await expect(connectConformanceNonOwner({ base: 'https://host.example', accountEmail: 'mxmx_test_conformance_other_123@inbox.example', stamp: '123', credentialSource: 'inbox-oauth', env: {} }, { acquireCredential })).rejects.toThrow('separate account');
  expect(acquireCredential).not.toHaveBeenCalled();
});
