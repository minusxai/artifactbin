import {createReadJobs} from './read-jobs';
import {SQL_READ_JOB_ROUTES} from '@artifactbin/contracts';
/**
 * THE SQL SERVICE, from the outside: the contract (re-exported from
 * @artifactbin/contracts), an HTTP client that speaks it, and the server
 * shell that serves ANY SqlService over the same wire. No engine here — the
 * engine is `@artifactbin/sql/local` (worker threads) or `./sqlite` (this
 * thread), and only a composition root loads one.
 */
import type { SqlService } from '@artifactbin/contracts';
import { SQL_ROUTES } from '@artifactbin/contracts';
import { jsonServer, type JsonServer } from '@artifactbin/utils';
import { DEFAULT_CAPS, type SqlCaps } from './caps';

export type * from '@artifactbin/contracts';
export { isQueryFailure, SQL_ROUTES } from '@artifactbin/contracts';
export { inferColumns } from './dataset-shape';
export { queryBounds } from './bounds';
// `sqlClient` lives in @artifactbin/utils; re-exported here so a caller can take the
// client from the same package as the shell it speaks to. That is how this package's
// own tests and the app's story tests reach it; app product code imports utils directly.
export { sqlClient } from '@artifactbin/utils';
export { DEFAULT_CAPS, type SqlCaps };

/** The one GET a shell answers — the liveness/readiness probe for whatever orchestrates the service. */
const HEALTH = '/health';

/**
 * One POST per method, plus `GET /health`. Holds no credentials, opens no database, reads no identity:
 * put it on a private network. The plumbing is utils' `jsonServer`, with this shell's health probe and secret.
 */
export function serveSql(svc: SqlService, opts: { maxBody?: number; serviceSecret?: string } = {}): JsonServer {
  const jobs=createReadJobs(svc.startRead?.bind(svc));
  const routes: Record<string, (body: unknown) => Promise<unknown>> = {
    [SQL_READ_JOB_ROUTES.open]:()=>jobs.open(),
    [SQL_READ_JOB_ROUTES.submit]:b=>jobs.submit(b as Parameters<typeof jobs.submit>[0]),
    [SQL_READ_JOB_ROUTES.status]:b=>jobs.status(b as Parameters<typeof jobs.status>[0]),
    [SQL_READ_JOB_ROUTES.cancel]:b=>jobs.cancel(b as Parameters<typeof jobs.cancel>[0]),
    [SQL_ROUTES.run]: async (b) => ({ results: await svc.run(b as Parameters<SqlService['run']>[0]) }),
    [SQL_ROUTES.runMany]: async (b) => ({ results: await svc.runMany(b as Parameters<SqlService['runMany']>[0]) }),
    [SQL_ROUTES.mutate]: async (b) => ({ result: await svc.mutate(b as Parameters<SqlService['mutate']>[0]) }),
    [SQL_ROUTES.dryRun]: (b) => svc.dryRun(b as Parameters<SqlService['dryRun']>[0]),
    [SQL_ROUTES.dryRunMutations]: (b) => svc.dryRunMutations(b as Parameters<SqlService['dryRunMutations']>[0]),
  };
  const server=jsonServer(routes, { maxBody: opts.maxBody ?? 64 * 1024 * 1024, health: HEALTH, serviceSecret: opts.serviceSecret, label: 'sql-shell',redactErrors:true });
  return {listen:server.listen,close:async()=>{await jobs.close();await server.close();}};
}
