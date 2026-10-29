/**
 * READINESS FOR THE WHOLE STACK — the one hop the app owns. `/health` on any
 * process answers for that process alone (that is what Docker restarts on);
 * this module answers "can a user be served right now?" by asking each
 * service the app depends on for ITS `/health`, one hop, in parallel, with a
 * short timeout. A service with no URL runs in-process and is trivially fine.
 *
 * The database is probed with `SELECT 1` inside the same deadline: a stack that cannot reach its database cannot
 * serve a user, so it reads as degraded. The object store is not probed. `app/health/route.ts` (the process's own
 * liveness) stays shallow on purpose.
 * Never throws — a probe that explodes is a probe that failed.
 */
import { getDb } from '@/lib/platform/db';
import { BROWSER_SERVICE_URL, EVENTS_SERVICE_URL, SQL_SERVICE_URL } from '@/lib/platform/config';

type ServiceName = 'sql' | 'browser' | 'events' | 'db';

/** The service URLs as configured: null = in-process. */
type ServiceUrls = Record<Exclude<ServiceName, 'db'>, string | null>;

interface StackHealth {
  ok: boolean;
  /** The services whose `/health` did not answer 2xx within the deadline, in `ServiceName` order. */
  failing: ServiceName[];
}

/** How long one probe may take before it counts as down. */
const PROBE_TIMEOUT_MS = 2000;

/** The URLs the app was configured with — the ONLY place they are read for readiness. */
function configuredServiceUrls(): ServiceUrls {
  return { sql: SQL_SERVICE_URL || null, browser: BROWSER_SERVICE_URL || null, events: EVENTS_SERVICE_URL || null };
}

/** The order a failure is reported in — the order the services are listed here. */
const SERVICE_NAMES: readonly Exclude<ServiceName, 'db'>[] = ['sql', 'browser', 'events'];

/**
 * One service's own `/health`. Healthy is a 2xx inside the deadline and
 * nothing else: a refused connection, a timeout, a 500 and a 404 are the same
 * answer to "can a user be served" — no. The probe carries no credential;
 * every service answers `/health` before its secret check.
 */
async function probe(base: string): Promise<boolean> {
  try {
    const response = await fetch(`${base.replace(/\/+$/, '')}/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: 'manual',
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** `SELECT 1` on the serving pool; healthy only if it answers inside the probe deadline. */
async function probeDatabase(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answered = (async () => { await (await getDb()).query('SELECT 1'); return true; })();
    answered.catch(() => {}); // a late failure after the deadline is not an unhandled rejection
    return await Promise.race([answered, new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS); })]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Probe the database and every configured service's `/health` in parallel; never throws. */
export async function stackHealth(urls: ServiceUrls = configuredServiceUrls(), databaseProbe: () => Promise<boolean> = probeDatabase): Promise<StackHealth> {
  const [database, ...healthy] = await Promise.all([
    databaseProbe().catch(() => false),
    ...SERVICE_NAMES.map((name) => {
      const base = urls[name];
      return base ? probe(base) : Promise.resolve(true);
    }),
  ]);
  const failing: ServiceName[] = SERVICE_NAMES.filter((_, index) => !healthy[index]);
  if (!database) failing.push('db');
  return { ok: failing.length === 0, failing };
}
