/**
 * The human at the other end of `afbin setup`, for the `cold` treatment.
 *
 * The CLI persists a pending device pairing at `~/.artifactbin/pairing-<hash>.json` with the user
 * code it printed, then polls for approval. A person would open the approval page and press
 * "approve" with their browser session; this does the same with the driver's session cookie, through
 * the agent's proxy so the origin the pairing was minted for is the one the approval names. The agent
 * never sees a token: the CLI receives its credential from the device door exactly as it would for a
 * person, and saves it itself.
 *
 * Only pairings the CLI has already accepted are approved — the file exists only after the CLI
 * validated the pairing against the selected origin — and each user code is approved once.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DRIVER_HEADER } from './proxy';

export interface ApproverOptions {
  /** The agent's HOME: the pairing file lives under its `.artifactbin`. */
  homeDir: string;
  /** Where the agent talks to the product; approvals go through the same proxy so the ledger stays honest. */
  agentBase: string;
  /** The origin the product believes it is served from; the approval door checks `Origin` against it. */
  publicOrigin: string;
  /** The driver's browser session, from `acquireCredential`. */
  cookie: string;
  fetch?: typeof fetch;
  log?: (message: string) => void;
  intervalMs?: number;
}
export interface Approver {
  /** User codes approved so far, in order. */
  readonly approved: string[];
  stop(): void;
}

interface PendingFile { userCode?: unknown; server?: unknown; expiresAt?: unknown }

export function startApprover(opts: ApproverOptions): Approver {
  const call = opts.fetch ?? fetch;
  const dir = path.join(opts.homeDir, '.artifactbin');
  const approved: string[] = [];
  const seen = new Set<string>();
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      let names: string[] = [];
      try { names = fs.readdirSync(dir).filter((n) => /^pairing-[0-9a-f]{16}\.json$/.test(n)); } catch { return; }
      for (const name of names) {
        let pending: PendingFile;
        try { pending = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as PendingFile; } catch { continue; }
        const code = typeof pending.userCode === 'string' ? pending.userCode : '';
        if (!code || seen.has(code)) continue;
        if (typeof pending.expiresAt === 'number' && pending.expiresAt < Date.now()) continue;
        seen.add(code);
        const response = await call(`${opts.agentBase}/oauth/device/approve`, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: opts.publicOrigin,
            Cookie: opts.cookie,
            [DRIVER_HEADER]: '1',
          },
          body: new URLSearchParams({ user_code: code, decision: 'approve' }).toString(),
        });
        if (response.ok) { approved.push(code); opts.log?.(`approved device pairing ${code}`); }
        else opts.log?.(`approval of ${code} answered HTTP ${response.status}`);
      }
    } finally { busy = false; }
  };
  const timer = setInterval(() => { void tick(); }, opts.intervalMs ?? 1000);
  timer.unref?.();
  return { approved, stop: () => clearInterval(timer) };
}
