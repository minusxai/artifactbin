import type {
  BrowserService,
  EventsService,
  DryRunMutationsResult,
  DryRunResult,
  MutationOutcome,
  QueryFailure,
  QueryOutcome,
  RenderRequest,
  RenderResult,
  SqlService,
} from '@artifactbin/contracts';
import { BROWSER_ROUTES, EVENTS_ROUTES, SERVICE_AUTH_HEADER, SQL_ROUTES } from '@artifactbin/contracts';
import { httpClient } from './http';

const SQL_DEFAULT_TIMEOUT_MS = 5_000;
const failure = (e: unknown): QueryFailure => ({ error: (e as Error)?.message ?? 'sql service unavailable' });

/** An HTTP client for the SQL service, with a deadline on every call. */
export function sqlClient(url: string, opts: { deadlineMs?: number; serviceSecret?: string } = {}): SqlService {
  const client = httpClient(url, { deadlineMs: opts.deadlineMs ?? SQL_DEFAULT_TIMEOUT_MS * 4, ...(opts.serviceSecret ? { headers: { [SERVICE_AUTH_HEADER]: opts.serviceSecret } } : {}) });
  return {
    async run(input) {
      try { return (await client.post<{ results: Record<string, QueryOutcome> }>(SQL_ROUTES.run, input)).results; }
      catch (e) { return Object.fromEntries(input.queries.map((q) => [q.name, failure(e)])); }
    },
    async mutate(input) {
      try { return (await client.post<{ result: MutationOutcome }>(SQL_ROUTES.mutate, input)).result; }
      catch (e) { return failure(e); }
    },
    async dryRun(input) {
      try { return await client.post<DryRunResult>(SQL_ROUTES.dryRun, { ...input, paramNames: [...input.paramNames] }); }
      catch (e) { return { errors: input.queries.map((q) => ({ name: q.name, error: failure(e).error })), columns: {} }; }
    },
    async dryRunMutations(input) {
      try { return await client.post<DryRunMutationsResult>(SQL_ROUTES.dryRunMutations, { ...input, paramNames: [...input.paramNames] }); }
      catch (e) { return { errors: input.mutations.map((m) => ({ name: m.name, error: failure(e).error })) }; }
    },
  };
}

/** An HTTP client for the browser service, with a deadline on every render. */
export function browserClient(url: string, opts: { deadlineMs?: number; serviceSecret?: string } = {}): BrowserService {
  const deadline = opts.deadlineMs ?? 30_000;
  return {
    async render(req: RenderRequest): Promise<RenderResult> {
      try {
        const res = await fetch(`${url}${BROWSER_ROUTES.render}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(opts.serviceSecret ? { [SERVICE_AUTH_HEADER]: opts.serviceSecret } : {}) }, body: JSON.stringify(req), signal: AbortSignal.timeout(deadline) });
        const type = res.headers.get('content-type') ?? '';
        if (res.ok && type.startsWith('image/')) return { ok: true, mime: type as 'image/png' | 'image/jpeg', bytes: new Uint8Array(await res.arrayBuffer()) };
        if (type.startsWith('application/json')) return (await res.json()) as RenderResult;
        return { ok: false, reason: 'unavailable', detail: `${res.status}` };
      } catch (e) {
        return { ok: false, reason: 'unavailable', detail: (e as Error).message };
      }
    },
  };
}

export interface QueryCaps { maxRows: number; timeoutMs: number }

/** Clamp requested query bounds to the service's configured ceilings. */
export function queryBounds(
  input: { limit?: number; timeoutMs?: number },
  caps: QueryCaps,
  page?: { limit: number } | null,
): { limit: number; timeoutMs: number } {
  const bound = (asked: number | undefined, ceiling: number): number => {
    if (asked === undefined || !Number.isFinite(asked)) return ceiling;
    return Math.min(Math.max(1, Math.trunc(asked)), ceiling);
  };
  return {
    limit: page ? bound(page.limit, caps.maxRows) : bound(input.limit, caps.maxRows),
    timeoutMs: bound(input.timeoutMs, caps.timeoutMs),
  };
}

export interface EventsClientOptions {
  /** Deadline on every POST. */
  deadlineMs?: number;
  serviceSecret?: string;
  /** A batch leaves after this long (default 1000 ms) … */
  batchMs?: number;
  /** … or when it holds this many envelopes (default 50), whichever first. */
  batchMax?: number;
  /** Envelopes waiting beyond this (default 1000) are dropped, with ONE warning line per overflow episode. */
  queueMax?: number;
}

/**
 * The HTTP client for the events service: `emit` enqueues and resolves at once
 * (never rejects, never blocks a request), a batch leaves every `batchMs` or at
 * `batchMax`, a failed POST is retried ONCE (the envelope ids make that safe),
 * and `close` flushes the tail — what the SIGTERM handler awaits before the
 * listener closes. A dead service costs the caller nothing but a log line.
 */
export function eventsClient(url: string, opts: EventsClientOptions = {}): EventsService {
  void url; void opts; void EVENTS_ROUTES;
  throw new Error('events-svc: implement eventsClient');
}
