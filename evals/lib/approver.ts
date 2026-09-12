/**
 * The human at the other end of `afbin auth`, for the flows where the driver stands in for the person.
 *
 * The CLI starts a device pairing (`POST /oauth/device`), prints the user code, and polls for approval.
 * A person would open the approval page and press "approve" with their browser session; this does the
 * same with the driver's session cookie, through the agent's proxy so the origin the pairing was minted
 * for is the one the approval names. The agent never sees a token: the CLI receives its credential from
 * the device door exactly as it would for a person, and saves it itself.
 *
 * Two ways to see a pairing, because two people start them:
 *  - `ledgerPath`: the AGENT ran `afbin auth`. Its traffic crossed the driver's recording proxy, whose
 *    ledger row for the device door carries the user code (lib/proxy). The ledger is the driver's own
 *    file — the agent's `~/.artifactbin` is 0700 and, under `--run-as`, unreadable by the driver, which
 *    is why reading the pairing file there silently approved nothing.
 *  - `homeDir`: the DRIVER ran `afbin auth` itself (the installed flow's precondition, lib/auth), in a
 *    home it owns, and its traffic need not cross a proxy; the CLI's pending-pairing file is the signal.
 *
 * Each user code is approved once; an expired pairing is left alone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DRIVER_HEADER } from './proxy';
import { cliPreinstalled, type EvalMode } from './mode';
import type { LedgerEntry } from './contracts';

export type PairingSource =
  | { /** The recording proxy's ledger for this task: pairings the agent's CLI started. */ ledgerPath: string; homeDir?: undefined }
  | { /** The HOME of a driver-run `afbin auth`: its pending-pairing file. */ homeDir: string; ledgerPath?: undefined };

export type ApproverOptions = PairingSource & {
  /** Where the agent talks to the product; approvals go through the same proxy so the ledger stays honest. */
  agentBase: string;
  /** The origin the product believes it is served from; the approval door checks `Origin` against it. */
  publicOrigin: string;
  /** The driver's browser session, from `acquireCredential`. */
  cookie: string;
  fetch?: typeof fetch;
  log?: (message: string) => void;
  intervalMs?: number;
};
export interface Approver {
  /** User codes approved so far, in order. */
  readonly approved: string[];
  stop(): void;
}

/**
 * DOES THIS RUN NEED AN APPROVER WATCHING THE AGENT'S TRAFFIC?
 *
 * Only `not-installed`: there the AGENT runs `afbin auth` mid-turn and nobody else can approve its
 * pairing, so a run without this watcher is a run whose agent never gets a credential. In `installed`
 * the driver already ran `afbin auth` itself before the turn and approved that pairing from the home it
 * owns (`lib/auth.ts`), so there is nothing left on the agent's side to watch for.
 *
 * Stated as a predicate rather than inline at the call site, because "the approver is wired for the
 * mode that needs it" is the one thing a not-installed leg cannot recover from.
 */
export function approverNeeded(mode: EvalMode): boolean {
  return !cliPreinstalled(mode);
}

interface Pairing { code: string; expiresAt: number | null }
interface PendingFile { userCode?: unknown; server?: unknown; expiresAt?: unknown }

/** Pairings the CLI persisted under a home the driver can read. */
export function pairingsFromHome(homeDir: string): Pairing[] {
  const dir = path.join(homeDir, '.artifactbin');
  let names: string[] = [];
  try { names = fs.readdirSync(dir).filter((n) => /^pairing-[0-9a-f]{16}\.json$/.test(n)); } catch { return []; }
  const out: Pairing[] = [];
  for (const name of names) {
    let pending: PendingFile;
    try { pending = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as PendingFile; } catch { continue; }
    if (typeof pending.userCode === 'string') out.push({ code: pending.userCode, expiresAt: typeof pending.expiresAt === 'number' ? pending.expiresAt : null });
  }
  return out;
}

/** Pairings the recording proxy saw the agent start (`POST /oauth/device` → 200 with a user code). */
export function pairingsFromLedger(ledgerPath: string): Pairing[] {
  let text: string;
  try { text = fs.readFileSync(ledgerPath, 'utf8'); } catch { return []; }
  const out: Pairing[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry: LedgerEntry;
    try { entry = JSON.parse(line) as LedgerEntry; } catch { continue; }
    if (typeof entry.userCode === 'string') out.push({ code: entry.userCode, expiresAt: typeof entry.pairingExpiresAt === 'number' ? entry.pairingExpiresAt : null });
  }
  return out;
}

export function startApprover(opts: ApproverOptions): Approver {
  const call = opts.fetch ?? fetch;
  const pending = opts.ledgerPath !== undefined ? () => pairingsFromLedger(opts.ledgerPath) : () => pairingsFromHome(opts.homeDir);
  const approved: string[] = [];
  const seen = new Set<string>();
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const { code, expiresAt } of pending()) {
        if (!code || seen.has(code)) continue;
        if (expiresAt !== null && expiresAt < Date.now()) continue;
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
        else opts.log?.(`approval of ${code} answered HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
      }
    } finally { busy = false; }
  };
  const timer = setInterval(() => { void tick(); }, opts.intervalMs ?? 1000);
  timer.unref?.();
  return { approved, stop: () => clearInterval(timer) };
}
