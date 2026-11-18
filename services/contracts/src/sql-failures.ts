/**
 * WHY A PAGE'S `sql` FAILED: the one list of codes every layer answers with. The page SQL door (stored datasets, live
 * datasets, the default connection), the connectors through `SQL_FAILURE_FOR_CONNECTOR`, the page runtime's `SqlError`,
 * `<af-chart>` and `<af-data-table>` use only these codes, and the author skill documents them
 * (references/datasets.md). A guard test refuses a code anywhere on those paths that is not here.
 *
 * THE WIRE: a refusal is `{error: code, message, notice?}`. `message` is the engine's or the rule's own reason, for
 * the page's author and agents (secrets removed, never a stack). `notice` is set on a failed READ: one plain sentence
 * for the person reading the page, what happened and, for access, what to do. `SqlError.message` is the notice when
 * there is one (else the reason), `SqlError.detail` the reason; the components show `message`.
 *
 * A PARTIAL ANSWER IS NOT A FAILURE: when a connection cut the rows at the row limit, the read answers them with
 * `truncated: true` (`rows.truncated` on the runtime's array). A stored dataset's read past the limit, and any answer
 * past the byte limit, is refused `result_too_large` instead.
 */
import type { ConnectorErrorCode } from './connectors';

/** Each code: its HTTP status at the page SQL door and, for a read, what the reader is told. */
export const SQL_FAILURES = /* @__PURE__ */ Object.freeze({
  /** The reader may not see this data (the database or the dataset's rules refused them), or may not make this write. */
  permission_denied: { status: 403, notice: 'You don\'t have access to this data. Ask the page\'s owner for access.' },
  /** The data answers signed-in people only, and the reader is not signed in. */
  sign_in_required: { status: 403, notice: 'Sign in to see this data.' },
  /** The database, the connection or the SQL engine could not be reached; or `sql` cannot run where the page is. */
  unavailable: { status: 503, notice: 'The data can\'t be reached right now.' },
  /**
   * Live data the reader has not allowed yet: a draft whose embedding app has not turned live reads on for this mount.
   * Not an access failure; the same read answers once the reader allows live data and the app shows the draft again.
   */
  consent_required: { status: 403, notice: 'Live data is paused until you allow it.' },
  /** The statement is not valid, or a guard refused it before it ran (the reason is in `message`). */
  validation_failed: { status: 400, notice: 'This data\'s query could not run; the page\'s owner needs to fix it.' },
  input_too_large: { status: 413, notice: 'This data\'s query is too large to run; the page\'s owner needs to shorten it.' },
  /** The read ran out of time. */
  timeout: { status: 408, notice: 'The data took too long to load. Try again in a moment.' },
  /** The answer is past the row or byte limit (a stored dataset's rows, any answer's bytes). */
  result_too_large: { status: 413, notice: 'There is more data here than a page can show; the page\'s owner needs to narrow it.' },
  /**
   * The dataset, table or database the statement names does not exist, is not linked, or is not readable by this
   * reader: a stored dataset the reader may not read is never told apart from a missing one.
   */
  dataset_not_found: { status: 404, notice: 'This data isn\'t available: it was removed, or you don\'t have access to it. Ask the page\'s owner.' },
  /** The page version the reader has open declares no query by that name. */
  unknown_query: { status: 404, notice: 'This page asks for a query it no longer declares. Reload the page.' },
  /** The data is a dataset's own connection, and this install reads live data only through its default one (connectors `OWN_CONNECTIONS_OFF`). */
  own_connections_off: { status: 403, notice: 'This data comes from a connection this install has turned off. Ask the page\'s owner.' },
  /** The page itself: missing, or not readable by this reader (the uniform answer). */
  not_found: { status: 404, notice: 'This page\'s data can\'t be read: the page is gone, or you no longer have access to it.' },
  /** The data changed under the read (or the write) too many times in a row. */
  dataset_changed: { status: 409, notice: 'The data changed while it was read. Reload to see it.' },
  /** The request did not come from the page's own site. */
  forbidden: { status: 403 },
  /** Writes only: what the rules refused, or a write whose outcome is unknown (read before writing again). */
  check_violation: { status: 403 },
  too_many_rows: { status: 413 },
  outcome_unknown: { status: 409 },
  invalid_idempotency_key: { status: 400 },
  /** The page runtime could not understand the reply. */
  unexpected: { status: 502, notice: 'This data could not be read.' },
} satisfies Record<string, { status: number; notice?: string }>);
export type SqlFailureCode = keyof typeof SQL_FAILURES;
export const SQL_FAILURE_CODES = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.keys(SQL_FAILURES) as SqlFailureCode[]);
export const isSqlFailureCode = (code: unknown): code is SqlFailureCode => typeof code === 'string' && Object.hasOwn(SQL_FAILURES, code);

/** Every connector error as the page answers it (contracts connectors `CONNECTOR_ERROR_CODES`). */
export const SQL_FAILURE_FOR_CONNECTOR: Readonly<Record<ConnectorErrorCode, SqlFailureCode>> = /* @__PURE__ */ Object.freeze({
  invalid_config: 'dataset_not_found',
  invalid_query: 'validation_failed',
  forbidden_address: 'unavailable',
  tls_required: 'unavailable',
  tls_unsupported: 'unavailable',
  tls_untrusted_certificate: 'unavailable',
  tls_name_mismatch: 'unavailable',
  connect_failed: 'unavailable',
  auth_failed: 'unavailable',
  permission_denied: 'permission_denied',
  // A write the read-only session refused is a refusal of the write, not of the reader.
  read_only: 'permission_denied',
  timeout: 'timeout',
  result_too_large: 'result_too_large',
  database_error: 'validation_failed',
  not_found: 'dataset_not_found',
  unavailable: 'unavailable',
});

/** A failed read's reply: the code, its reason and the reader's sentence. */
export function sqlReadFailure(code: SqlFailureCode, message: string): { status: number; body: { error: SqlFailureCode; message: string; notice?: string } } {
  const failure: { status: number; notice?: string } = SQL_FAILURES[code];
  return { status: failure.status, body: { error: code, message, ...(failure.notice ? { notice: failure.notice } : {}) } };
}
