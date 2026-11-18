/**
 * The analytics suites' shared fixture (analytics*.test.ts): the session and request stand-ins, event rows and polls.
 */
import { afterEach, beforeEach, expect, vi, type MockInstance } from 'vitest';
import { request } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import * as analytics from '@/lib/analytics';
import { flushViews } from '@/lib/analytics';
import { EVENTS_SCHEMA, getDb } from '@/lib/platform';

export const BASE = 'http://localhost:3000';

// Owns the session for this file (the harness setSession): id + email, settable per test.
export const sessionUser = { id: '', email: '' };

// Owns the request-headers mock: empty = called OFF a request (the server is
// holding none — exactly like production code called from a test), populated =
// a request carrying these headers (lib/request-context).
export const requestHeaders = new Map<string, string>();

export { params } from '@/__tests__/harness';


/** Run a page function, mapping notFound/redirect throws to outcomes. */
export async function outcome(p: Promise<unknown>): Promise<'render' | 'redirect' | 'notFound'> {
  try {
    // The pages answer as data now (test/helpers/pages): the outcome IS the value.
    const value = await p;
    if (value && typeof value === 'object' && 'kind' in (value as Record<string, unknown>)) return (value as { kind: 'render' | 'redirect' | 'notFound' }).kind;
    return 'render';
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? '';
    if (digest.startsWith('NEXT_REDIRECT')) return 'redirect';
    return 'notFound';
  }
}

export interface Wire { id: string; edit_id: string; version: number }

export async function create(token: string, body: Record<string, unknown>): Promise<Wire> {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));
  expect(res.status).toBe(201);
  return res.json() as Promise<Wire>;
}

export async function eventRows(artifactId?: string): Promise<{ event: string; artifact_id: string; user_id: string | null; client: string | null }[]> {
  const db = await getDb();
  const r = await db.query<{ event: string; artifact_id: string; user_id: string | null; client: string | null }>(
    `SELECT CASE verb WHEN 'viewed' THEN 'view' WHEN 'exported' THEN 'export'
       WHEN 'created' THEN 'create' WHEN 'updated' THEN 'update' WHEN 'edited' THEN 'edit'
       WHEN 'mutated' THEN 'mutate' WHEN 'reverted' THEN 'revert' WHEN 'forked' THEN 'fork'
       WHEN 'deleted' THEN 'delete' END AS event,
       object_id AS artifact_id, payload->>'user_id' AS user_id, payload->>'client' AS client
     FROM ${EVENTS_SCHEMA}.events WHERE object_kind='artifact' ${artifactId ? 'AND object_id = $1' : ''} ORDER BY position`,
    artifactId ? [artifactId] : [],
  );
  return r.rows;
}

/**
 * Events are fired unawaited — poll until the expected row lands. Views are buffered and written in batches (every 2s,
 * lib/analytics VIEW_FLUSH_MS), so each poll writes the buffer now rather than waiting out the timer.
 */
export async function expectEvent(artifactId: string, event: string): Promise<{ user_id: string | null; client: string | null }> {
  let match: { user_id: string | null; client: string | null } | undefined;
  await vi.waitFor(async () => {
    if (event === 'view') await flushViews();
    match = (await eventRows(artifactId)).find((r) => r.event === event);
    expect(match).toBeDefined();
  }, { timeout: 3000 });
  return match!;
}

/** The writes of every `trackEvent` the code under test fired (it is fire-and-forget), held for `settle`. Call once per file. */
const tracked: Promise<unknown>[] = [];
export function holdTelemetry() {
  let spy: MockInstance<typeof analytics.trackEvent> | undefined;
  beforeEach(() => {
    const real = analytics.trackEvent;
    spy = vi.spyOn(analytics, 'trackEvent').mockImplementation((...args) => { const write = real(...args); tracked.push(write); return write; });
  });
  afterEach(() => { spy?.mockRestore(); tracked.length = 0; });
}

/** Before an absence check: every telemetry write already fired has landed, and every buffered view is written (a view
 * the 2s batch has not written yet would otherwise pass). recordView and trackEvent read only request metadata
 * (no I/O) before they queue, so one event-loop turn has queued every view and started every event. */
export const settle = async () => { await new Promise((r) => setImmediate(r)); await Promise.all(tracked.splice(0)); await flushViews(); };
