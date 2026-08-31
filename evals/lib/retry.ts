/**
 * The driver's OWN setup calls, retried.
 *
 * An agent's turn is paid for the moment it starts; the driver's request that
 * sets the task up is not, and losing the first to a blip in the second is the
 * worst trade in the run. Measured: three tasks of one production leg died on
 * `POST /api/start → 502`, all within 200 ms of each other, at the moment three
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
  prompt: string;
}

/**
 * Mint the task's start document, through the proxy the agent will use — the
 * product builds the document URL in the paste from the request's origin, so this call is what
 * puts the proxy's address in the agent's hands. Retried for the reason above:
 * the agent's turn is paid and this is not.
 */
export async function mintStartDocument(
  agentBase: string,
  driverHeader: string,
  opts: RetryOptions = {},
): Promise<StartDocument> {
  return withRetry(`POST ${agentBase}/api/start`, async () => {
    const res = await fetch(`${agentBase}/api/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [driverHeader]: '1' },
      body: '{}',
    });
    if (isTransientStatus(res.status)) return null;
    if (!res.ok) throw new FatalError(`POST /api/start → ${res.status}`);
    return (await res.json()) as StartDocument;
  }, opts);
}
