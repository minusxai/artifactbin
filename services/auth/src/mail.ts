/** Outgoing mail: a local, file-backed development outbox or verified-TLS SMTP / fixed-endpoint Resend. */
import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createTransport } from 'nodemailer';
import { isLoopbackName } from '@artifactbin/contracts';
import type { ConnectionOptions } from 'node:tls';
import type { Mailer, OutgoingMail } from './auth/human';

export class MailNotConfigured extends Error { constructor() { super('mail is not configured (EMAIL__RESEND_API_KEY or EMAIL__SMTP_HOST)'); } }
export class MailSendFailed extends Error { constructor(public readonly status: number) { super(`mail send failed: ${status}`); } }

interface ResendOptions { apiKey?: string; from: string; fetch?: typeof fetch }
export interface SmtpSettings { host: string; port: number; secure: boolean; user?: string; password?: string }
export interface MailSettings { apiKey?: string; from: string; smtp?: SmtpSettings }
interface RuntimeMailerOptions extends ResendOptions, MailSettings { publicBaseUrl: string; devOutboxPath?: string }
interface DevOutboxOptions { path?: string; reset?: boolean; log?: (line: string) => void }

export const DEV_OUTBOX_RELATIVE_PATH = '.artifactbin/dev-mail.jsonl';
export const DEV_OUTBOX_DEFAULT_PATH = resolve(tmpdir(), 'artifactbin-dev-mail.jsonl');
export const resolveDevOutboxPath = (value?: string): string => resolve(value?.trim() || DEV_OUTBOX_DEFAULT_PATH);
const RESEND_API_URL = 'https://api.resend.com';
const OTP_TTL_MS = 10 * 60 * 1000;

const html = (m: OutgoingMail): string =>
  m.kind === 'otp'
    ? `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;line-height:1.6;color:#0b0e11"><p>Your artifactbin login code is</p><p style="font-size:32px;font-weight:600;letter-spacing:0.18em;margin:16px 0">${m.otp}</p><p style="color:#57606a">It expires in 10 minutes. If you didn't ask to log in, ignore this email.</p></div>`
    : `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;line-height:1.6;color:#0b0e11"><p>${m.text.replace(/</g, '&lt;')}</p></div>`;

const contentOf = (mail: OutgoingMail) => ({
  subject: mail.kind === 'otp' ? `${mail.otp} is your artifactbin login code` : mail.subject,
  text: mail.kind === 'otp' ? `Your artifactbin login code is ${mail.otp}\n\nIt expires in 10 minutes. If you didn't ask to log in, ignore this email.` : mail.text,
  html: mail.html ?? html(mail),
});

export function resendMailer(opts: ResendOptions): Mailer {
  const doFetch = opts.fetch ?? fetch;
  return {
    async send(mail) {
      if (!opts.apiKey) throw new MailNotConfigured();
      const res = await doFetch(`${RESEND_API_URL}/emails`, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json',...(mail.idempotencyKey?{'Idempotency-Key':mail.idempotencyKey}:{}) },
        body: JSON.stringify({ from: opts.from, to: [mail.to], ...contentOf(mail) }),
      });
      if (!res.ok) throw new MailSendFailed(res.status);
    },
  };
}

/** A narrow trust-root override supports deterministic TLS fixtures; certificate verification is always enabled. */
export function smtpMailer(opts: { from: string; smtp: SmtpSettings }, trust: { ca?: ConnectionOptions['ca'] } = {}): Mailer {
  const smtp = opts.smtp;
  const transport = createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure, requireTLS: !smtp.secure,
    ...(smtp.user && smtp.password ? { auth: { user: smtp.user, pass: smtp.password } } : {}),
    tls: { rejectUnauthorized: true, ...(trust.ca ? { ca: trust.ca } : {}) },
    dnsTimeout: 15000, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 15000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  });
  return { async send(mail) {
    try {
      const result = await transport.sendMail({ from: opts.from, to: mail.to, ...contentOf(mail) });
      if (!result.accepted.length || result.rejected.length) throw new Error('recipient not accepted');
    } catch {
      // Provider replies can echo AUTH credentials, recipients or message contents. Never retain a cause.
      throw new Error('mail send failed: SMTP delivery failed');
    }
  } };
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
    // The loopback names (contracts `isLoopbackName`): localhost and every name under it (RFC 6761), and
    // lvh.me and every name under it (127.0.0.1 in public DNS, development's app and pages host).
    return isLoopbackName(host) || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

export function mailerForRuntime(opts: RuntimeMailerOptions): Mailer {
  if (usesDevOutbox(opts.publicBaseUrl)) return devOutboxMailer({ path: opts.devOutboxPath });
  if (opts.smtp && opts.apiKey) throw new Error('Configure either SMTP or Resend, never both.');
  return opts.smtp ? smtpMailer({ from: opts.from, smtp: opts.smtp }) : resendMailer(opts);
}
