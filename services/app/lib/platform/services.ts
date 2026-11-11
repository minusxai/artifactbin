/**
 * WHERE THE APP GETS ITS SERVICES. The app tree never decides — and never
 * imports — where the SQL engine or Chromium run. A URL in config means an HTTP
 * client; otherwise whatever the COMPOSITION ROOT registered (`server/host.ts`
 * from its caller's options, `test/setup/vitest.setup.ts` — the local
 * implementations, from the `./local` entries only they may reach); otherwise a
 * noop that says so rather than a silent empty result.
 *
 * A configured URL WINS over a registration, so a root may register
 * unconditionally without having to re-read the deployment's mind — though
 * the roots do check, because resolving `./local` at all is what the lean
 * image cannot do.
 *
 * Injection happens ONCE, not per call: the call sites are deep in lib/
 * (sql/engine, events, export, operations) and have no request context to
 * carry a service through. The registry lives on `globalThis`, like the
 * export renderer's state — a root registers once per PROCESS, and a module
 * reload in a test must not silently turn the engine back into a noop.
 *
 * IDENTITY (contracts `IdentityService`, every write to users, tokens, groups and memberships) has no noop: with
 * `AUTH__SERVICE_URL` it is the auth host over HTTP; otherwise the identity store runs here, on this process's own
 * database (a single-process install and the tests), plain SQL that every image can load.
 */
import type { HumanSessionAuthority, BrowserService, EventsService, IdentityService, SqlService, TransactionalQueryable } from '@artifactbin/contracts';
import { createIdentityStore } from '@artifactbin/auth/identity-store';
import { humanSessionClient, identityClient, browserClient, eventsClient, noopBrowser, noopEvents, noopSql, sqlClient } from '@artifactbin/utils';
import { AUTH_SERVICE_URL, BROWSER_SERVICE_URL, EVENTS_SERVICE_URL, INTERNAL_SERVICE_SECRET, QUERY_TIMEOUT_MS, SQL_SERVICE_URL, TEST_DOMAIN } from './config';
import { getDb } from './db';

export interface Services { humanSessions:HumanSessionAuthority; identity:IdentityService; sql: SqlService; browser: BrowserService; events: EventsService }

type Registry = Partial<Services>;
declare global {
  // eslint-disable-next-line no-var
  var __artifact_bin_services__: Registry | undefined;
}
const registry = (): Registry => (globalThis.__artifact_bin_services__ ??= {});

const remote: Registry = {
  ...(AUTH_SERVICE_URL ? {humanSessions:humanSessionClient(AUTH_SERVICE_URL,{serviceSecret:INTERNAL_SERVICE_SECRET??''}),identity:identityClient(AUTH_SERVICE_URL,{serviceSecret:INTERNAL_SERVICE_SECRET??''})} : {}),
  ...(SQL_SERVICE_URL ? { sql: sqlClient(SQL_SERVICE_URL, { deadlineMs: QUERY_TIMEOUT_MS * 4, ...(INTERNAL_SERVICE_SECRET ? { serviceSecret: INTERNAL_SERVICE_SECRET } : {}) }) } : {}),
  ...(BROWSER_SERVICE_URL ? { browser: browserClient(BROWSER_SERVICE_URL, { ...(INTERNAL_SERVICE_SECRET ? { serviceSecret: INTERNAL_SERVICE_SECRET } : {}) }) } : {}),
  ...(EVENTS_SERVICE_URL ? { events: eventsClient(EVENTS_SERVICE_URL, { ...(INTERNAL_SERVICE_SECRET ? { serviceSecret: INTERNAL_SERVICE_SECRET } : {}) }) } : {}),
};
/** The app's own database as the store's: opened (or reopened after a test's reset) on each use. */
const appDatabase: TransactionalQueryable = {
  query: async (sql, params) => (await getDb()).query(sql, params),
  transaction: async fn => (await getDb()).transaction(fn),
};
/** Whether identity runs in this process (no auth host configured): its boot rows are then this process's to ensure. */
export const identityIsLocal = (): boolean => !AUTH_SERVICE_URL;
const noops: Omit<Services, 'identity'> = {humanSessions:{live:async()=>false}, sql: noopSql(), browser: noopBrowser(), events: noopEvents() };

/** Register the local implementations (or fakes). A configured URL always wins over a registration. */
export function setServices(local: Registry): void {
  Object.assign(registry(), local);
}

export function services(): Services {
  const local = registry();
  return {
    humanSessions:remote.humanSessions??local.humanSessions??noops.humanSessions,
    identity:remote.identity??local.identity??createIdentityStore({db:appDatabase,testDomain:TEST_DOMAIN}),
    sql: remote.sql ?? local.sql ?? noops.sql,
    browser: remote.browser ?? local.browser ?? noops.browser,
    events: remote.events ?? local.events ?? noops.events,
  };
}
