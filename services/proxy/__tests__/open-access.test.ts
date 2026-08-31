/** Retired launch settings must never close the login-code door again (master #173, ported to the parts). */
import { describe, expect, it } from 'vitest';
import { assemble } from '@artifactbin/utils';
import { proxyParts, type ProxyOptions } from '../src/parts';
import { testProxyOptions } from './helpers';

describe('the open login door', () => {
  it('sends a code without an invite even when stale launch settings remain', async () => {
    const sent: string[] = [];
    const base = await testProxyOptions();
    const options: ProxyOptions = {
      ...base,
      env: { ...base.env, INVITE__CODE: 'retired', WAITLIST__WEBHOOK_URL: 'https://retired.test/hook' },
      sessions: { resolve: async () => null, handler: async () => { sent.push('open@example.com'); return Response.json({ ok: true }); } },
    };
    const proxy = assemble(proxyParts(options));
    const res = await proxy.request('http://proxy/api/auth/email-otp/send-verification-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'open@example.com', type: 'sign-in' }),
    });
    expect(res.status).toBe(200);
    expect(sent).toEqual(['open@example.com']);
  });
});
