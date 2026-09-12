/**
 * The driver's OWN setup calls, retried.
 *
 * An agent's turn is paid for the moment it starts; the driver's request that
 * sets the task up is not, and losing the first to a blip in the second is the
 * worst trade in the run. Measured: three tasks of one production leg died on
 * the start-document mint, all within 200 ms of each other, at the moment three
 * proxies opened at once against a deployment that was mid-roll. Nothing about
 * the agent, the mode or the product was learned — the column simply had three
 * holes, and its total stopped being comparable to the others'.
 *
 * Deliberately narrow: only the driver's own setup, never the agent's traffic
 * (which is the measurement and must not be re-run), and only on the failures
 * that are transient by nature — a connection that did not complete, or a
 * gateway that has not got a server behind it yet. A 4xx is an answer, and
 * retrying an answer just asks it twice.
 */
const TRANSIENT_STATUS = new Set([502, 503, 504, 429]);

export interface RetryOptions {
  attempts?: number;
  /** Grows linearly: a deployment mid-roll needs seconds, not milliseconds. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function isTransientStatus(status: number): boolean {
  return TRANSIENT_STATUS.has(status);
}

/**
 * A failure that will not get better by asking again. `withRetry` retries a
 * bare throw because that is what an unfinished socket looks like — so an
 * answer the caller has already judged final has to say so out loud, or it gets
 * asked four times with backoff between. Caught by pointing the real thing at a
 * server that returns 400: it made four requests where it should have made one.
 */
export class FatalError extends Error {}

/**
 * Runs `attempt` until it returns without signalling a transient failure.
 * `attempt` reports one by returning null (a caller inspecting a Response) or
 * by throwing (a socket that never connected).
 */
export async function withRetry<T>(what: string, attempt: () => Promise<T | null>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const delayMs = opts.delayMs ?? 2000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: unknown = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const got = await attempt();
      if (got !== null) return got;
      last = new Error(`${what} was unavailable`);
    } catch (err) {
      if (err instanceof FatalError) throw err;
      last = err;
    }
    if (i < attempts) await sleep(delayMs * i);
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export interface StartDocument {
  id: string;
}

/**
 * THE DOCUMENT EVERY TASK STARTS FROM, created as the eval account.
 *
 * The account is the one the agent's own CLI will authenticate as, so the document it is pointed at
 * must belong to that account too, or it is handed something its credential cannot write. It carries
 * the placeholder shape a start document has (so `published` still compares the agent's work against a
 * document it did not write) and is `unlisted`, so every anonymous product-truth read —
 * `/a/<id>/raw?chrome=0`, `/export`, the browser checks — sees it. Measured on artifactbin.dev: an
 * account-owned unlisted document reads anonymously (89 KB of HTML, placeholder visible).
 *
 * Marked with the driver header: it is the DRIVER's call and must not land in the agent's ledger.
 * Retried because the agent's turn is paid for and this is not.
 */
export const START_PLACEHOLDER_MARKUP = '<div data-design="tw" className="@container p-8"><h1 className="text-2xl font-bold">Untitled</h1><p>Waiting for your agent…</p></div>';

export async function mintStartDocumentAs(
  agentBase: string,
  driverHeader: string,
  token: string,
  opts: RetryOptions = {},
): Promise<StartDocument> {
  return withRetry(`POST ${agentBase}/api/artifacts (as the eval account)`, async () => {
    const res = await fetch(`${agentBase}/api/artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, [driverHeader]: '1' },
      body: JSON.stringify({ markup: START_PLACEHOLDER_MARKUP, title: 'Untitled', visibility: 'unlisted' }),
    });
    if (isTransientStatus(res.status)) return null;
    if (!res.ok) throw new FatalError(`POST /api/artifacts (as the eval account) → ${res.status}`);
    const body = (await res.json()) as { id?: string };
    if (!body.id) throw new FatalError('POST /api/artifacts (as the eval account) returned no id');
    // The agent is handed the base and the id; its credential is its own to obtain.
    return { id: body.id };
  }, opts);
}
