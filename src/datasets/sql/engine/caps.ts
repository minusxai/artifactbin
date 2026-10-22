// Adapted from Apache-2.0 licensed SQL engine; see LICENSE and NOTICE.
/** The two caps every call is clamped to. Set once by createSql; a request may lower them, never raise them. */
export interface SqlCaps {
  maxRows: number;
  timeoutMs: number;
}
export const DEFAULT_CAPS: SqlCaps = { maxRows: 10_000, timeoutMs: 5_000 };
