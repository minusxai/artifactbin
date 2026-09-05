/**
 * READINESS FOR THE WHOLE STACK — the one hop the app owns. `/health` on any
 * process answers for that process alone (that is what Docker restarts on);
 * this module answers "can a user be served right now?" by asking each
 * service the app depends on for ITS `/health`, one hop, in parallel, with a
 * short timeout. A service with no URL runs in-process and is trivially fine.
 *
 * No database probe, no object store probe: a blip there is not an outage to
 * page on, and `app/health/route.ts` states the same rule for the same reason.
 * Never throws — a probe that explodes is a probe that failed.
 */
import { BROWSER_SERVICE_URL, EVENTS_SERVICE_URL, SQL_SERVICE_URL } from '@/lib/config';

export type ServiceName = 'sql' | 'browser' | 'events';

/** The service URLs as configured: null = in-process. */
export type ServiceUrls = Record<ServiceName, string | null>;

export interface StackHealth {
  ok: boolean;
  /** The services whose `/health` did not answer 2xx within the deadline, in `ServiceName` order. */
  failing: ServiceName[];
}

/** How long one probe may take before it counts as down. */
export const PROBE_TIMEOUT_MS = 2000;

/** The URLs the app was configured with — the ONLY place they are read for readiness. */
export function configuredServiceUrls(): ServiceUrls {
  return { sql: SQL_SERVICE_URL || null, browser: BROWSER_SERVICE_URL || null, events: EVENTS_SERVICE_URL || null };
}

/** Probe every configured service's `/health` in parallel; never throws. */
export async function stackHealth(urls: ServiceUrls = configuredServiceUrls()): Promise<StackHealth> {
  void urls;
  throw new Error('api-health: implement stackHealth');
}
