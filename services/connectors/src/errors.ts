/**
 * THE ONE ERROR SHAPE (contracts `ConnectorError`): every connector rejects with a `ConnectorFailure`, and a driver's
 * own error becomes one through `driverFailure`, which keeps the database's SQLSTATE and message, maps sign-in,
 * TLS, network and timeout failures to their codes, and removes every secret of the connection from the text.
 */
import type { ConnectorError, ConnectorErrorCode } from '@artifactbin/contracts';

export class ConnectorFailure extends Error implements ConnectorError {
  constructor(readonly code: ConnectorErrorCode, message: string) { super(message); this.name = 'ConnectorFailure'; }
  toJSON(): ConnectorError { return { code: this.code, message: this.message }; }
}

/** The `ConnectorError` an error carries, or `unavailable` for anything else (whose text is never shown). */
export function connectorError(error: unknown): ConnectorError {
  return error instanceof ConnectorFailure ? { code: error.code, message: error.message } : { code: 'unavailable', message: 'the connection failed' };
}

const UNTRUSTED_CODES = new Set(['SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT']);
const UNTRUSTED_REASON = /self[- ]signed certificate|unable to get local issuer certificate|unable to get issuer certificate|unable to verify the first certificate/;
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED', 'PROTOCOL_CONNECTION_LOST']);
/** Postgres 28P01/28000 and MySQL 28000 (ER_ACCESS_DENIED_ERROR) are a refused sign-in. */
const AUTH_STATES = new Set(['28P01', '28000']);
/** Postgres 25006 and MySQL 25006 (ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION): the session refused a write. */
const READ_ONLY_STATES = new Set(['25006']);
/** Postgres 57014 (statement_timeout) and MySQL 3024 (max_execution_time, HY000). */
const isTimeout = (state: string | undefined, errno: unknown) => state === '57014' || errno === 3024;

type DriverError = { name?: string; code?: unknown; message?: unknown; sqlState?: unknown; sqlMessage?: unknown; errno?: unknown; reason?: unknown; cert?: unknown; tlsUnsupported?: boolean };

/** One bounded line, with every secret removed. */
function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) if (secret && secret.length >= 3) out = out.split(secret).join('[redacted]');
  return out.split(/\r?\n/, 1)[0]!.slice(0, 300);
}

export function driverFailure(raw: unknown, secrets: readonly string[]): ConnectorFailure {
  if (raw instanceof ConnectorFailure) return new ConnectorFailure(raw.code, redact(raw.message, secrets));
  const e = (raw && typeof raw === 'object' ? raw : {}) as DriverError;
  const code = typeof e.code === 'string' ? e.code : undefined;
  const message = String(e.message ?? '');
  const fail = (c: ConnectorErrorCode, text: string) => new ConnectorFailure(c, redact(text, secrets));
  if (e.tlsUnsupported || code === 'HANDSHAKE_NO_SSL_SUPPORT') return fail('tls_unsupported', 'the database server does not offer TLS; enable TLS on the server');
  // postgres.js: a server error is a PostgresError whose code is the SQLSTATE.
  const state = e.name === 'PostgresError' ? code : typeof e.sqlState === 'string' ? e.sqlState : undefined;
  if (state) {
    const text = `${state} ${e.name === 'PostgresError' ? message : String(e.sqlMessage ?? message)}`;
    if (AUTH_STATES.has(state) || e.errno === 1045) return fail('auth_failed', `the database refused the sign-in (${state})`);
    // No such database (Postgres 3D000, MySQL 1049): what followed default: names nothing there.
    if (state === '3D000' || e.errno === 1049) return fail('invalid_config', `the database does not exist (${state}): ${e.name === 'PostgresError' ? message : String(e.sqlMessage ?? message)}`);
    // The database refused this person (Postgres 42501, MySQL 1227/1142/1044): its own message says why.
    if (state === '42501' || e.errno === 1227 || e.errno === 1142 || e.errno === 1044) return fail('permission_denied', e.name === 'PostgresError' ? message : String(e.sqlMessage ?? message));
    if (READ_ONLY_STATES.has(state)) return fail('read_only', `this connection is read-only: ${text}`);
    if (isTimeout(state, e.errno)) return fail('timeout', 'the query ran past its time limit');
    return fail('database_error', text);
  }
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID' || (code === 'HANDSHAKE_SSL_ERROR' && e.reason !== undefined && e.cert)) return fail('tls_name_mismatch', 'the server\'s certificate does not name this host; connect with a host name the certificate lists');
  if ((code && UNTRUSTED_CODES.has(code)) || (code === 'HANDSHAKE_SSL_ERROR' && UNTRUSTED_REASON.test(message))) return fail('tls_untrusted_certificate', 'the server\'s certificate is not trusted: add your provider\'s CA certificate to the connection');
  if (code && NETWORK_CODES.has(code)) return fail('connect_failed', `the database could not be reached (${code})`);
  if (code === 'ER_ACCESS_DENIED_ERROR') return fail('auth_failed', 'the database refused the sign-in');
  return fail('database_error', code ?? (message || 'failed'));
}
