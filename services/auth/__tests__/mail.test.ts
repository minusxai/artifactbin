import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEV_OUTBOX_DEFAULT_PATH, MailNotConfigured, MailSendFailed, devOutboxMailer, mailerForRuntime, resendMailer, resolveDevOutboxPath, usesDevOutbox } from '../src/mail';
import { mailSettingsOf } from '../src/config';
import { authEnvNamesRead } from '../src/env';

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
  it('selects the local outbox only for loopback origins — a hosted deployment never writes a code to disk', async () => {
    // Both return a bare `{ send }`, so which one was chosen is only visible in what a send DOES.
    // That is the point of the check: a hosted origin that got the outbox would write every login
    // code to a file, which is an auth bypass, and `not.toThrow()` could not tell the difference.
    const file = join(mkdtempSync(join(tmpdir(), 'artifactbin-mail-runtime-')), 'outbox.jsonl');
    const message = { to: 'dev@example.com', kind: 'otp', subject: 'x', text: 'x' } as const;

    const local = mailerForRuntime({ publicBaseUrl: 'http://localhost:3030', from: 'x', devOutboxPath: file, smtp: { host: 'smtp.invalid', port: 587, secure: false } });
    await local.send({ ...message, otp: '424242' });
    expect(JSON.parse(readFileSync(file, 'utf8').trim())).toMatchObject({ to: 'dev@example.com', otp: '424242' });

    // The hosted origin gets Resend, which refuses without a key rather than writing anywhere.
    const hosted = mailerForRuntime({ publicBaseUrl: 'https://artifactbin.dev', from: 'x', devOutboxPath: file });
    await expect(hosted.send({ ...message, otp: '999999' })).rejects.toBeInstanceOf(MailNotConfigured);
    expect(readFileSync(file, 'utf8')).not.toContain('999999');
  });
  it('counts lvh.me and its names as loopback (documents on their own origins in development), and nothing that merely contains it', () => {
    for (const url of ['http://app.lvh.me:11001', 'http://lvh.me:3030']) expect(usesDevOutbox(url), url).toBe(true);
    for (const url of ['https://lvh.me.example.com', 'https://evil-lvh.me', 'https://app.example.com']) expect(usesDevOutbox(url), url).toBe(false);
  });
  it('counts every name under localhost as loopback (RFC 6761), and nothing that merely contains it', () => {
    for (const url of ['http://app.localhost:7445', 'http://app.afbin.localhost:7445', 'http://localhost:3030']) expect(usesDevOutbox(url), url).toBe(true);
    for (const url of ['https://localhost.example.com', 'https://notlocalhost', 'https://app.test']) expect(usesDevOutbox(url), url).toBe(false);
  });

  it('refuses to send without a key, and reports a failed send with its status', async () => {
    await expect(resendMailer({ from: 'x' }).send({ to: 'a', kind: 'other', subject: 's', text: 't' })).rejects.toBeInstanceOf(MailNotConfigured);
    const f = (async () => new Response('secret-key 123456', { status: 500 })) as unknown as typeof fetch;
    await expect(resendMailer({ apiKey: 'k', from: 'x', fetch: f }).send({ to: 'a', kind: 'other', subject: 's', text: 't' })).rejects.toBeInstanceOf(MailSendFailed);
    await expect(resendMailer({ apiKey: 'k', from: 'x', fetch: f }).send({ to: 'a', kind: 'other', subject: 's', text: 't' })).rejects.toThrow('mail send failed: 500');
  });
});

describe('the product name in mail (APP__NAME)', () => {
  const sent = async (env: Record<string, string | undefined>) => {
    const bodies: Array<Record<string, unknown>> = [];
    const f = (async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response('{}'); }) as unknown as typeof fetch;
    await resendMailer({ ...mailSettingsOf({ EMAIL__RESEND_API_KEY: 're_test', ...env }), fetch: f }).send({ to: 'a@example.com', kind: 'otp', subject: 'x', text: 'x', otp: '123456' });
    return bodies[0] as { subject: string; text: string; html: string };
  };
  it('unset, says artifactbin exactly as before', async () => {
    expect(mailSettingsOf({ APP__NAME: '   ' })).not.toHaveProperty('productName');
    expect(authEnvNamesRead().has('APP__NAME')).toBe(true);
    expect(await sent({})).toMatchObject({
      subject: '123456 is your artifactbin login code',
      text: "Your artifactbin login code is 123456\n\nIt expires in 10 minutes. If you didn't ask to log in, ignore this email.",
      html: `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;line-height:1.6;color:#0b0e11"><p>Your artifactbin login code is</p><p style="font-size:32px;font-weight:600;letter-spacing:0.18em;margin:16px 0">123456</p><p style="color:#57606a">It expires in 10 minutes. If you didn't ask to log in, ignore this email.</p></div>`,
    });
  });
  it('set, names the install in the subject, text and HTML of the sign-in code mail', async () => {
    const mail = await sent({ APP__NAME: '  Acme Data ' });
    expect(mail.subject).toBe('123456 is your Acme Data login code');
    expect(mail.text).toBe("Your Acme Data login code is 123456\n\nIt expires in 10 minutes. If you didn't ask to log in, ignore this email.");
    expect(mail.html).toContain('<p>Your Acme Data login code is</p>');
    expect(JSON.stringify([mail.subject, mail.text, mail.html])).not.toContain('artifactbin');
  });
  it('is plain text: escaped in HTML, verbatim in the subject and text', async () => {
    const mail = await sent({ APP__NAME: 'R&D <Tools> "Lab"' });
    expect(mail.html).toContain('<p>Your R&amp;D &lt;Tools&gt; &quot;Lab&quot; login code is</p>');
    expect(mail.subject).toBe('123456 is your R&D <Tools> "Lab" login code');
  });
  it('refuses control characters (no header injection) and names longer than 60 characters, naming the setting only', () => {
    for (const value of ['Acme\r\nBcc: x@example.com', 'Acme\nData', 'Acme\u0000', 'Acme\u007f', 'x'.repeat(61)])
      expect(() => mailSettingsOf({ APP__NAME: value }), JSON.stringify(value)).toThrow(/^APP__NAME must be/);
    expect(mailSettingsOf({ APP__NAME: 'x'.repeat(60) }).productName).toBe('x'.repeat(60));
  });
});
