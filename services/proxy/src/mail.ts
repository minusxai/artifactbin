/** Outgoing mail: a local, file-backed development outbox or fixed-endpoint Resend. */
import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { Mailer, OutgoingMail } from './auth/human';

export class MailNotConfigured extends Error { constructor() { super('mail is not configured (EMAIL__RESEND_API_KEY)'); } }
export class MailSendFailed extends Error { constructor(public readonly status: number, body: string) { super(`mail send failed: ${status} ${body.slice(0, 200)}`); } }

export interface ResendOptions { apiKey?: string; from: string; fetch?: typeof fetch }
export interface RuntimeMailerOptions extends ResendOptions { publicBaseUrl: string; devOutboxPath?: string }
export interface DevOutboxOptions { path?: string; reset?: boolean; log?: (line: string) => void }

export const DEV_OUTBOX_RELATIVE_PATH = '.artifactbin/dev-mail.jsonl';
export const DEV_OUTBOX_DEFAULT_PATH = resolve(tmpdir(), 'artifactbin-dev-mail.jsonl');
export const resolveDevOutboxPath = (value?: string): string => resolve(value?.trim() || DEV_OUTBOX_DEFAULT_PATH);
const RESEND_API_URL = 'https://api.resend.com';
const OTP_TTL_MS = 10 * 60 * 1000;

const html = (m: OutgoingMail): string =>
  m.kind === 'otp'
    ? `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;line-height:1.6;color:#0b0e11"><p>Your artifactbin login code is</p><p style="font-size:32px;font-weight:600;letter-spacing:0.18em;margin:16px 0">${m.otp}</p><p style="color:#57606a">It expires in 10 minutes. If you didn't ask to log in, ignore this email.</p></div>`
    : `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;line-height:1.6;color:#0b0e11"><p>${m.text.replace(/</g, '&lt;')}</p></div>`;

export function resendMailer(opts: ResendOptions): Mailer {
  const doFetch = opts.fetch ?? fetch;
  return {
    async send(mail) {
      if (!opts.apiKey) throw new MailNotConfigured();
      const subject = mail.kind === 'otp' ? `${mail.otp} is your artifactbin login code` : mail.subject;
      const text = mail.kind === 'otp' ? `Your artifactbin login code is ${mail.otp}\n\nIt expires in 10 minutes. If you didn't ask to log in, ignore this email.` : mail.text;
      const res = await doFetch(`${RESEND_API_URL}/emails`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: opts.from, to: [mail.to], subject, html: html(mail), text }),
      });
      if (!res.ok) throw new MailSendFailed(res.status, await res.text().catch(() => ''));
    },
  };
}

export function devOutboxMailer(opts: DevOutboxOptions = {}): Mailer {
  const outboxPath = resolveDevOutboxPath(opts.path);
  mkdirSync(dirname(outboxPath), { recursive: true, mode: 0o700 });
  if (opts.reset !== false) writeFileSync(outboxPath, '', { mode: 0o600 });
  chmodSync(outboxPath, 0o600);
  const report = opts.log ?? console.info;
  return {
    async send(mail) {
      const createdAt = new Date();
      appendFileSync(outboxPath, `${JSON.stringify({
        ...mail,
        createdAt: createdAt.toISOString(),
        ...(mail.kind === 'otp' ? { expiresAt: new Date(createdAt.getTime() + OTP_TTL_MS).toISOString() } : {}),
      })}\n`, { mode: 0o600 });
      if (mail.kind === 'otp' && mail.otp) report(`[dev-mail] otp email=${mail.to} code=${mail.otp}`);
    },
  };
}

export function usesDevOutbox(publicBaseUrl: string): boolean {
  try {
    const host = new URL(publicBaseUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

export function mailerForRuntime(opts: RuntimeMailerOptions): Mailer {
  if (usesDevOutbox(opts.publicBaseUrl)) return devOutboxMailer({ path: opts.devOutboxPath });
  return resendMailer(opts);
}
