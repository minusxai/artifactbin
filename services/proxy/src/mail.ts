/**
 * Outgoing mail — Resend over HTTP, ported from the app's lib/email. The base
 * URL is configurable ON PURPOSE: every browser gate points it at a local sink
 * and reads the login code out of the captured POST, because there is
 * deliberately no endpoint that exposes a live code. Unconfigured (no API key)
 * = refuse to send; there is no log-the-code fallback (a code in a log is an
 * auth bypass).
 */
import type { Mailer, OutgoingMail } from './auth/human';

export class MailNotConfigured extends Error { constructor() { super('mail is not configured (EMAIL__RESEND_API_KEY)'); } }
export class MailSendFailed extends Error { constructor(public readonly status: number, body: string) { super(`mail send failed: ${status} ${body.slice(0, 200)}`); } }

export interface ResendOptions { apiKey?: string; baseUrl?: string; from: string; fetch?: typeof fetch }

const html = (m: OutgoingMail): string =>
  m.kind === 'otp'
    ? `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;line-height:1.6;color:#0b0e11"><p>Your artifactbin login code is</p><p style="font-size:32px;font-weight:600;letter-spacing:0.18em;margin:16px 0">${m.otp}</p><p style="color:#57606a">It expires in 10 minutes. If you didn't ask to log in, ignore this email.</p></div>`
    : `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;line-height:1.6;color:#0b0e11"><p>${m.text.replace(/</g, '&lt;')}</p></div>`;

export function resendMailer(opts: ResendOptions): Mailer {
  const doFetch = opts.fetch ?? fetch;
  const base = (opts.baseUrl ?? 'https://api.resend.com').replace(/\/$/, '');
  return {
    async send(mail) {
      if (!opts.apiKey) throw new MailNotConfigured();
      const subject = mail.kind === 'otp' ? `${mail.otp} is your artifactbin login code` : mail.subject;
      const text = mail.kind === 'otp' ? `Your artifactbin login code is ${mail.otp}\n\nIt expires in 10 minutes. If you didn't ask to log in, ignore this email.` : mail.text;
      const res = await doFetch(`${base}/emails`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: opts.from, to: [mail.to], subject, html: html(mail), text }),
      });
      if (!res.ok) throw new MailSendFailed(res.status, await res.text().catch(() => ''));
    },
  };
}
