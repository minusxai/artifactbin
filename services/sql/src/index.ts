/**
 * THE SQL SERVICE, from the outside: the contract (re-exported from
 * @artifactbin/contracts/sql), an HTTP client that speaks it, and the server
 * shell that serves ANY SqlService over the same wire. No engine here — the
 * server composes `@artifactbin/sql/local` (worker threads). Tests can compose
 * `@artifactbin/sql/testing` in the calling thread.
 */
import type { SqlService } from '@artifactbin/contracts/sql';
import { SQL_ROUTES } from '@artifactbin/contracts/sql';
import { jsonServer, type JsonServer, type JsonRoutes } from '@artifactbin/utils/http';

export type * from '@artifactbin/contracts/sql';
export { SQL_ROUTES } from '@artifactbin/contracts/sql';
// `sqlClient` lives in @artifactbin/utils; re-exported here so a caller can take the
// client from the same package as the shell it speaks to. That is how this package's
// own tests and the app's story tests reach it; app product code imports utils directly.
export { sqlClient } from '@artifactbin/utils/clients';

/** The one GET a shell answers — the liveness/readiness probe for whatever orchestrates the service. */
const HEALTH = '/health';

/**
 * One POST per method, plus `GET /health`. Holds no credentials, opens no database, reads no identity:
 * put it on a private network. The plumbing is utils' `jsonServer`, with this shell's health probe and secret.
 */
export function serveSql(svc: SqlService, opts: { maxBody?: number; serviceSecret?: string } = {}): JsonServer {
  const routes: JsonRoutes = {
    [SQL_ROUTES.readPolicy]: async () => ({version:1,queryTimeoutMs:svc.readPolicy?.queryTimeoutMs??null}),
    [SQL_ROUTES.run]: async (b, context) => ({ results: await svc.run(b as Parameters<SqlService['run']>[0], context) }),
    [SQL_ROUTES.mutate]: async (b) => ({ result: await svc.mutate(b as Parameters<SqlService['mutate']>[0]) }),
    [SQL_ROUTES.dryRunMutations]: (b) => svc.dryRunMutations(b as Parameters<SqlService['dryRunMutations']>[0]),
  };
  return jsonServer(routes, { maxBody: opts.maxBody ?? 64 * 1024 * 1024, health: HEALTH, serviceSecret: opts.serviceSecret, label: 'sql-shell',redactErrors:true });
}
