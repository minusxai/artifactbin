/**
 * The mail sink half a dozen proxy tests wrote inline: a mailer that records instead of sending, so a
 * test can read back the login code it was supposed to receive. Structurally typed against the mail
 * seam rather than importing it, which keeps this package free of a dependency on any service.
 */

export interface SentMail {
  to: string;
  otp?: string;
  kind?: string;
  subject?: string;
  text?: string;
}

export interface MailSink {
  /** Every message the code under test handed the mailer, oldest first. */
  sent: SentMail[];
  /** The last message, or `undefined` — the assertion most of these tests actually make. */
  last(): SentMail | undefined;
  /** Pass this where the production mailer goes. */
  mail: { send(message: SentMail): Promise<void> };
}

export function mailSink(): MailSink {
  const sent: SentMail[] = [];
  return {
    sent,
    last: () => sent.at(-1),
    mail: { send: async (message) => { sent.push(message); } },
  };
}
