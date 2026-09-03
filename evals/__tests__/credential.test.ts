/**
 * The token never rides the prompt in plugin and MCP modes: the driver logs in like a person (email code, read
 * from the eval's Resend inbox) and grants like an MCP client (OAuth + PKCE), once per leg. Decided 2026-09-03.
 * Seeded RED by the orchestrator.
 */
import { describe, expect, it } from 'vitest';
import { callbackCode, codeFromMail, credentialSourceFor, pickLoginMail, pkcePair } from '../lib/credential';

describe('credential source per mode', () => {
  const inbox = { RESEND_EVAL_API_KEY: 're_x', EVAL_LOGIN_EMAIL: 'mxmx_eval@social-worm.resend.app' };
  it('copy-text mode keeps the paste line', () => {
    expect(credentialSourceFor('fetched_skill+api_action', inbox)).toBe('paste');
  });
  it('the other three modes log in through the inbox when it is configured', () => {
    for (const m of ['installed_skill+api_action', 'fetched_skill+mcp_action', 'installed_skill+mcp_action'] as const) {
      expect(credentialSourceFor(m, inbox), m).toBe('inbox-oauth');
    }
  });
  it('a pre-provisioned account token is the fallback, and no source at all is an error that names the env', () => {
    expect(credentialSourceFor('installed_skill+mcp_action', { EVAL_ACCOUNT_TOKEN: 'mx_abc' })).toBe('secret');
    expect(() => credentialSourceFor('installed_skill+mcp_action', {})).toThrow(/RESEND_EVAL_API_KEY|EVAL_ACCOUNT_TOKEN/);
  });
});

describe('the pure pieces of the login', () => {
  it('reads the six-digit code out of the login mail', () => {
    expect(codeFromMail('Your code is 482913')).toBe('482913');
    expect(codeFromMail('nothing here')).toBeNull();
  });
  it('picks the newest mail to the eval address sent after the request, ignoring older and foreign mail', () => {
    const since = Date.parse('2026-09-03T13:00:00Z');
    const list = [
      { id: 'old', to: ['mxmx_eval@social-worm.resend.app'], created_at: '2026-09-03T12:59:00Z', subject: 'Your login code' },
      { id: 'other', to: ['someone@social-worm.resend.app'], created_at: '2026-09-03T13:00:30Z', subject: 'Your login code' },
      { id: 'a', to: ['mxmx_eval@social-worm.resend.app'], created_at: '2026-09-03T13:00:10Z', subject: 'Your login code' },
      { id: 'b', to: ['mxmx_eval@social-worm.resend.app'], created_at: '2026-09-03T13:00:20Z', subject: 'Your login code' },
    ];
    expect(pickLoginMail(list, { to: 'mxmx_eval@social-worm.resend.app', since })?.id).toBe('b');
    expect(pickLoginMail(list.slice(0, 2), { to: 'mxmx_eval@social-worm.resend.app', since })).toBeNull();
  });
  it('PKCE: the challenge is the S256 of the verifier, base64url', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkcePair().verifier).not.toBe(verifier);
  });
  it('reads the authorization code off the consent redirect', () => {
    expect(callbackCode('http://127.0.0.1:9987/cb?code=abc123&state=s')).toBe('abc123');
    expect(callbackCode('http://127.0.0.1:9987/cb?error=access_denied')).toBeNull();
  });
});
