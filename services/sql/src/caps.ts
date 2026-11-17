import { SQL_QUERY_DEFAULT_MS, SQL_QUERY_MAX_MS, sqlTimeout } from '@artifactbin/contracts';
/** timeoutMs is the read cap. mutationTimeoutMs preserves explicit legacy write configuration;
 * omitted mutationTimeoutMs inherits an explicitly supplied timeoutMs for constructor compatibility.
 * App/standalone composition pass the separate 5000 default when that operator setting is absent. */
export interface SqlCaps { maxRows: number; timeoutMs: number; mutationTimeoutMs: number }
export const DEFAULT_CAPS: SqlCaps = { maxRows: 10_000, timeoutMs: SQL_QUERY_DEFAULT_MS, mutationTimeoutMs: 5_000 };
export function sqlCaps(opts: Partial<SqlCaps>): SqlCaps {
  return { ...DEFAULT_CAPS, ...opts,
    timeoutMs: sqlTimeout(opts.timeoutMs, DEFAULT_CAPS.timeoutMs, SQL_QUERY_MAX_MS, 'SQL__QUERY_TIMEOUT_MS'),
    mutationTimeoutMs: sqlTimeout(opts.mutationTimeoutMs ?? opts.timeoutMs, 5_000, SQL_QUERY_MAX_MS, 'mutation timeout'),
  };
}
