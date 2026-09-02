import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEV_OUTBOX_DEFAULT_PATH, MailNotConfigured, MailSendFailed, devOutboxMailer, mailerForRuntime, resendMailer, resolveDevOutboxPath } from '../src/mail';

describe('resendMailer', () => {
  it('posts the Resend shape — the login code in the subject and the text, never logged', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const f = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return new Response('{}'); }) as unknown as typeof fetch;
    const m = resendMailer({ apiKey: 're_test', from: 'artifactbin <login@example.com>', fetch: f });
    await m.send({ to: 'a@example.com', kind: 'otp', subject: 'x', text: 'x', otp: '123456' });
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    expect(calls[0].body).toMatchObject({ from: 'artifactbin <login@example.com>', to: ['a@example.com'], subject: '123456 is your artifactbin login code' });
    expect(String(calls[0].body.text)).toContain('123456');
  });
  it('writes local OTPs to a protected development outbox', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'artifactbin-mail-')), 'outbox.jsonl');
    const log = vi.fn();
    const m = devOutboxMailer({ path: file, log });
    await m.send({ to: 'dev@example.com', kind: 'otp', subject: 'x', text: 'x', otp: '123456' });
    expect(JSON.parse(readFileSync(file, 'utf8').trim())).toMatchObject({ to: 'dev@example.com', otp: '123456' });
    expect(log).toHaveBeenCalledWith('[dev-mail] otp email=dev@example.com code=123456');
  });
  it('treats a blank optional outbox path as unset, never as the process directory', () => {
    expect(resolveDevOutboxPath('')).toBe(DEV_OUTBOX_DEFAULT_PATH);
    expect(resolveDevOutboxPath('   ')).toBe(DEV_OUTBOX_DEFAULT_PATH);
  });
  it('selects the local outbox only for loopback origins', () => {
    expect(mailerForRuntime({ publicBaseUrl: 'http://localhost:3030', from: 'x', devOutboxPath: join(tmpdir(), 'artifactbin-local-mail') })).toBeTruthy();
    expect(() => mailerForRuntime({ publicBaseUrl: 'https://artifactbin.dev', from: 'x' })).not.toThrow();
  });
  it('refuses to send without a key, and reports a failed send with its status', async () => {
    await expect(resendMailer({ from: 'x' }).send({ to: 'a', kind: 'other', subject: 's', text: 't' })).rejects.toBeInstanceOf(MailNotConfigured);
    const f = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(resendMailer({ apiKey: 'k', from: 'x', fetch: f }).send({ to: 'a', kind: 'other', subject: 's', text: 't' })).rejects.toBeInstanceOf(MailSendFailed);
  });
});
