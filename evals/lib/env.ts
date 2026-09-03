/** Read `.env` into a map without touching `process.env` — the driver hands keys to harnesses explicitly. */
import fs from 'node:fs';

export function readDotEnv(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/**
 * WHERE A LEG'S CREDENTIAL COMES FROM — the only three names the driver reads for it, in one place
 * (`lib/credential` takes this shape and nothing else, so no module below it touches `process.env`):
 *
 * - `RESEND_EVAL_API_KEY` + `EVAL_LOGIN_EMAIL` — the eval's own inbound mailbox, which is what lets
 *   the driver do the REAL user journey: ask the product for a login code and read it out of the mail.
 *   `EVAL_LOGIN_EMAIL` names the INBOX, not the account: against a deployment each harness signs in as
 *   its own `+<harness>` sub-address of it (`lib/credential deploymentLoginEmail`) — one catch-all
 *   mailbox, but a login door and an account per harness, since the door is five sends an hour per address.
 * - `EVAL_ACCOUNT_TOKEN` — a pre-provisioned account token, the fallback where no inbox is configured
 *   (a laptop, a fork's CI) so the plugin and MCP modes can still run.
 */
export interface CredentialEnv {
  RESEND_EVAL_API_KEY?: string;
  EVAL_LOGIN_EMAIL?: string;
  EVAL_ACCOUNT_TOKEN?: string;
}

export const CREDENTIAL_ENV_KEYS = ['RESEND_EVAL_API_KEY', 'EVAL_LOGIN_EMAIL', 'EVAL_ACCOUNT_TOKEN'] as const;

/** The credential names out of a key map (`.env` under the process environment), and nothing else. */
export function credentialEnv(keys: Record<string, string | undefined>): CredentialEnv {
  const out: CredentialEnv = {};
  for (const key of CREDENTIAL_ENV_KEYS) if (keys[key]) out[key] = keys[key];
  return out;
}
