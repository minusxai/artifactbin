import { describe, expect, it, vi } from 'vitest';
import { MailNotConfigured, MailSendFailed, resendMailer } from '../src/mail';

describe('resendMailer', () => {
  it('posts the Resend shape — the login code in the subject and the text, never logged', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const f = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return new Response('{}'); }) as unknown as typeof fetch;
    const m = resendMailer({ apiKey: 're_test', baseUrl: 'http://127.0.0.1:4600', from: 'artifactbin <login@example.com>', fetch: f });
    await m.send({ to: 'a@example.com', kind: 'otp', subject: 'x', text: 'x', otp: '123456' });
    expect(calls[0].url).toBe('http://127.0.0.1:4600/emails');
    expect(calls[0].body).toMatchObject({ from: 'artifactbin <login@example.com>', to: ['a@example.com'], subject: '123456 is your artifactbin login code' });
    expect(String(calls[0].body.text)).toContain('123456');
  });
  it('refuses to send without a key, and reports a failed send with its status', async () => {
    await expect(resendMailer({ from: 'x' }).send({ to: 'a', kind: 'other', subject: 's', text: 't' })).rejects.toBeInstanceOf(MailNotConfigured);
    const f = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(resendMailer({ apiKey: 'k', from: 'x', fetch: f }).send({ to: 'a', kind: 'other', subject: 's', text: 't' })).rejects.toBeInstanceOf(MailSendFailed);
  });
});
