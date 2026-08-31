/**
 * Fire-and-forget usage analytics — the only module that touches
 * `analytics_events`.
 *
 * The contract that matters: `trackEvent` NEVER rejects and never throws. It
 * is called as `void trackEvent(...)` from request paths, and an unhandled
 * rejection would kill the process (there is no global handler on purpose).
 * The other rule is placement: never call it from INSIDE a `db.transaction`
 * callback — on PGLite the transaction holds the serialized op queue, so an
 * unawaited query enqueued behind it deadlocks. Fire after the txn resolves.
 *
 * The `client` column is the harness guess from lib/client-identity, derived
 * from the request's User-Agent via the request context — so lib callers need
 * no signature change to carry it. Outside a request scope (tests calling
 * helpers directly) the column stays NULL.
 * MCP callers are stateless per request, so they are identified by UA only —
 * Claude Code's bare `node` UA lands as 'script'. Telemetry only: nothing may
 * ever gate on this value.
 *
 * The `visitor` column is a daily-rotating fingerprint —
 * sha256(day:ip:ua:ANALYTICS_SECRET) — its OWN secret (ANALYTICS__SECRET, falling back to the auth secret), so rotating auth never rewrites every "views" number — and every "views" number this module
 * reports is COUNT(DISTINCT visitor): unique people per day, so a refresh
 * never inflates a count. No raw IP or UA is ever stored, the embedded day
 * kills cross-day identity, and legacy NULL-visitor rows coalesce to their
 * own seq (each counts once, undedupable). Known trade: one office NAT +
 * one browser build = one visitor that day.
 */
import { createHash } from 'crypto';
import { currentHeaders } from './request-context';
import { forwardedFor, identifyClient } from '@/lib/client-identity';
import { ANALYTICS_SECRET, TRUSTED_PROXY_HOPS } from '@/lib/config';
import { getDb } from '@/lib/db';

export type AnalyticsEvent =
  | 'view'
  | 'export'
  | 'sse_connect'
  | 'create'
  | 'update'
  | 'edit'
  /** A reader wrote rows to a dataset through a document's <Mutation>. */
  | 'mutate'
  | 'revert'
  | 'delete';

/** Fire-and-forget: never rejects. Callers write `void trackEvent(...)`; tests may await it. */
export async function trackEvent(
  event: AnalyticsEvent,
  artifactId: string,
  opts: { userId?: string | null } = {},
): Promise<void> {
  try {
    let client: string | null = null;
    let visitor: string | null = null;
    try {
      const h = await currentHeaders();
      if (!h) throw new Error('off-request');
      const ua = h.get('user-agent');
      client = identifyClient({ userAgent: ua }).harness;
      // The visitor key: a DAILY-ROTATING salted hash, never the raw IP or UA
      // (Plausible-style). Same person, same day → same key, so a refresh is
      // not a new view; the embedded day means no cross-day identity exists,
      // and the secret keeps the tiny IPv4 space from being brute-forced back
      // out of the hash. The user id joins the hash when present, so two
      // accounts behind one NAT + browser still count as two people. The IP is
      // the hop the nearest TRUSTED proxy appended (lib/client-identity
      // forwardedFor) — reading the caller-supplied head instead would let a
      // header split one visitor into unlimited distinct ones.
      const ip = forwardedFor(h, TRUSTED_PROXY_HOPS);
      if (ip || ua) {
        const day = new Date().toISOString().slice(0, 10);
        visitor = createHash('sha256')
          .update(`${day}:${ip}:${ua ?? ''}:${opts.userId ?? ''}:${ANALYTICS_SECRET}`)
          .digest('hex')
          .slice(0, 32);
      }
    } catch {
      // Outside a Next request scope (tests, detached work) — no UA to read.
    }
    const db = await getDb();
    await db.query('INSERT INTO analytics_events (event, artifact_id, user_id, client, visitor) VALUES ($1, $2, $3, $4, $5)', [
      event,
      artifactId,
      opts.userId ?? null,
      client,
      visitor,
    ]);
  } catch {
    // Analytics must never take a request down with it.
  }
}

/** How many days of history the dashboard splines show. */
export const VIEW_SERIES_DAYS = 30;

/**
 * Daily view counts per artifact across everything the user owns, zero-filled
 * to exactly `days` buckets (oldest → newest, last bucket = today UTC).
 * Artifacts with no views in the window are absent from the map.
 */
export async function viewSeriesByUser(
  userId: string,
  days: number = VIEW_SERIES_DAYS,
): Promise<Map<string, number[]>> {
  const db = await getDb();
  // to_char pins the bucket key to a plain UTC date string — TIMESTAMPTZ
  // round-trips as driver-dependent Date/string shapes, a text key doesn't.
  // AT TIME ZONE 'UTC' pins the DAY itself: bare date_trunc cuts in the
  // session timezone (PGLite inherits the machine's), and the JS zero-fill
  // below counts UTC days — on a PDT laptop the two disagreed from 5pm to
  // midnight, and "today" came back empty.
  const r = await db.query<{ artifact_id: string; day: string; n: number }>(
    `SELECT e.artifact_id, to_char(date_trunc('day', e.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
       COUNT(DISTINCT COALESCE(e.visitor, e.seq::text))::int AS n
     FROM analytics_events e
     JOIN artifacts a ON a.id = e.artifact_id
     WHERE a.user_id = $1 AND e.event = 'view' AND e.created_at > now() - ($2::int * interval '1 day')
     GROUP BY e.artifact_id, day`,
    [userId, days],
  );
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  const series = new Map<string, number[]>();
  for (const row of r.rows) {
    const age = Math.round((today - Date.parse(row.day)) / 86_400_000);
    const idx = days - 1 - age;
    if (idx < 0 || idx >= days) continue;
    const buckets = series.get(row.artifact_id) ?? new Array<number>(days).fill(0);
    buckets[idx] = row.n;
    series.set(row.artifact_id, buckets);
  }
  return series;
}

export interface DailyViews {
  /** UTC calendar day, 'YYYY-MM-DD'. */
  day: string;
  views: number;
}

/**
 * All-time daily view totals pooled across everything the user owns,
 * zero-filled from the first viewed day through today (empty when no views).
 */
export async function dailyViewsByUser(userId: string): Promise<DailyViews[]> {
  const db = await getDb();
  const r = await db.query<{ day: string; views: number }>(
    `SELECT to_char(date_trunc('day', e.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
       COUNT(DISTINCT COALESCE(e.visitor, e.seq::text))::int AS views
     FROM analytics_events e
     JOIN artifacts a ON a.id = e.artifact_id
     WHERE a.user_id = $1 AND e.event = 'view'
     GROUP BY day
     ORDER BY day`,
    [userId],
  );
  if (r.rows.length === 0) return [];
  const byDay = new Map(r.rows.map((row) => [row.day, row.views]));
  const out: DailyViews[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (let t = Date.parse(r.rows[0].day); ; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ day, views: byDay.get(day) ?? 0 });
    if (day >= today) break;
  }
  return out;
}
