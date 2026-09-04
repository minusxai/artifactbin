/**
 * WHERE THE APP GETS ITS SERVICES. The app tree never decides — and never
 * imports — where DuckDB or Chromium run. A URL in config means an HTTP
 * client; otherwise whatever the COMPOSITION ROOT registered (`server.mts`,
 * `app-only.mts`, `test/setup/vitest.setup.ts` — the local implementations,
 * from the `./local` entries only they may reach); otherwise a noop that says
 * so rather than a silent empty result.
 *
 * A configured URL WINS over a registration, so a root may register
 * unconditionally without having to re-read the deployment's mind — though
 * the roots do check, because resolving `./local` at all is what the lean
 * image cannot do.
 *
 * Injection happens ONCE, not per call: the call sites are deep in lib/
 * (dataflow, mutate, data-checks, export) and have no request context to
 * carry a service through. The registry lives on `globalThis`, like the
 * export renderer's state — a root registers once per PROCESS, and a module
 * reload in a test must not silently turn the engine back into a noop.
 */
import type { BrowserService, EventsService, SqlService } from '@artifactbin/contracts';
import { browserClient, eventsClient, noopBrowser, noopEvents, noopSql, sqlClient } from '@artifactbin/utils';
import { BROWSER_SERVICE_URL, EVENTS_SERVICE_URL, INTERNAL_SERVICE_SECRET, QUERY_TIMEOUT_MS, SQL_SERVICE_URL } from '@/lib/config';

export interface Services { sql: SqlService; browser: BrowserService; events: EventsService }

type Registry = Partial<Services>;
declare global {
  // eslint-disable-next-line no-var
  var __artifact_bin_services__: Registry | undefined;
}
const registry = (): Registry => (globalThis.__artifact_bin_services__ ??= {});

const remote: Registry = {
  ...(SQL_SERVICE_URL ? { sql: sqlClient(SQL_SERVICE_URL, { deadlineMs: QUERY_TIMEOUT_MS * 4, ...(INTERNAL_SERVICE_SECRET ? { serviceSecret: INTERNAL_SERVICE_SECRET } : {}) }) } : {}),
  ...(BROWSER_SERVICE_URL ? { browser: browserClient(BROWSER_SERVICE_URL, { ...(INTERNAL_SERVICE_SECRET ? { serviceSecret: INTERNAL_SERVICE_SECRET } : {}) }) } : {}),
  ...(EVENTS_SERVICE_URL ? { events: eventsClient(EVENTS_SERVICE_URL, { ...(INTERNAL_SERVICE_SECRET ? { serviceSecret: INTERNAL_SERVICE_SECRET } : {}) }) } : {}),
};
const noops: Services = { sql: noopSql(), browser: noopBrowser(), events: noopEvents() };

/** Register the local implementations (or fakes). A configured URL always wins over a registration. */
export function setServices(local: Registry): void {
  Object.assign(registry(), local);
}

export function services(): Services {
  const local = registry();
  return {
    sql: remote.sql ?? local.sql ?? noops.sql,
    browser: remote.browser ?? local.browser ?? noops.browser,
    events: remote.events ?? local.events ?? noops.events,
  };
}
