/**
 * WHAT EVERY CONNECTOR SHARES ABOUT AN ANSWER: the effective limits (a query may lower CONNECTOR_LIMITS, never raise
 * them), the collector that stops at the row limit (`truncated`) and fails past the byte limit, the viewer and
 * namespace checks, and the value rules of the common types:
 *
 *  - `number`: a JS number. A 64-bit integer outside ±2^53 stays its exact decimal string (an id must not round);
 *    a DECIMAL/NUMERIC becomes the nearest number (a chart's value), its string only when not finite (NaN).
 *  - `date` `YYYY-MM-DD`; `timestamp` ISO 8601, `…Z` when the database stores an instant (the session runs in UTC),
 *    without a zone when it stores a wall-clock time; `boolean` true/false; `json` the parsed value; arrays are `json`.
 *  - `text` everything else; binary values as `\x` and lowercase hex.
 */
import type { ConnectorAnswer, ConnectorColumn, ConnectorDialect, ConnectorJson, ConnectorLimits, ConnectorQuery, ConnectorValueType } from '@artifactbin/contracts';
import { CONNECTOR_LIMITS } from '@artifactbin/contracts';
import { ConnectorFailure } from './errors';

export function limitsOf(query: Pick<ConnectorQuery, 'limits'>): ConnectorLimits {
  const lower = (name: keyof ConnectorLimits) => {
    const asked = query.limits?.[name];
    return typeof asked === 'number' && Number.isInteger(asked) && asked > 0 ? Math.min(asked, CONNECTOR_LIMITS[name]) : CONNECTOR_LIMITS[name];
  };
  return { rows: lower('rows'), bytes: lower('bytes'), timeoutMs: lower('timeoutMs') };
}

/**
 * What follows `default:`: on Postgres and MySQL the database a session opens, passed through as written (a gateway's
 * `warehouse/finance` included) in the handshake, never into SQL text; on BigQuery a dataset. Bounded and plain.
 */
const NAMESPACE = /^[A-Za-z0-9_][A-Za-z0-9_$.:\/-]{0,127}$/;
export function checkedNamespace(_dialect: ConnectorDialect, namespace: string | undefined): string | undefined {
  if (namespace === undefined || namespace === '') return undefined;
  if (!NAMESPACE.test(namespace)) throw new ConnectorFailure('invalid_query', 'what follows default: is a database name: letters, digits and _ $ . : / -, at most 128');
  return namespace;
}

/** The viewer's three values as the session gets them (empty and `[]` for nobody; groups sorted JSON), bounded. */
export function viewerValues(query: Pick<ConnectorQuery, 'viewer'>): { id: string; email: string; groups: string } {
  const id = query.viewer?.id ?? '', email = query.viewer?.email ?? '', list = [...(query.viewer?.groups ?? [])].sort();
  const groups = JSON.stringify(list);
  if (id.length > 256 || email.length > 320 || list.some((g) => typeof g !== 'string') || groups.length > 64 * 1024 || /[\0\r\n]/.test(id + email + groups)) throw new ConnectorFailure('invalid_query', 'the viewer\'s values are malformed');
  return { id, email, groups };
}

const SAFE = /^-?\d{1,15}$/;
export function numberValue(value: unknown): ConnectorJson {
  if (typeof value === 'number' || value === null) return Number.isFinite(value) || value === null ? value as number | null : String(value);
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  const text = String(value);
  if (/^-?\d+$/.test(text)) return SAFE.test(text) || Number.isSafeInteger(Number(text)) ? Number(text) : text;
  const n = Number(text);
  return Number.isFinite(n) ? n : text;
}
export function timestampValue(text: string, instant: boolean): string {
  // `2026-01-02 03:04:05.123+00` / `2026-01-02 03:04:05`: the session's zone is UTC, so an instant normally ends +00.
  const iso = text.replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) return text;
  if (!instant) return iso;
  const zone = /([+-])(\d{2})(?::?(\d{2}))?$/.exec(iso);
  if (!zone) return iso.endsWith('Z') ? iso : `${iso}Z`;
  if (zone[2] === '00' && (zone[3] ?? '00') === '00') return `${iso.slice(0, zone.index)}Z`;
  const at = new Date(`${iso.slice(0, zone.index)}${zone[1]}${zone[2]}:${zone[3] ?? '00'}`);
  return Number.isNaN(at.getTime()) ? text : at.toISOString().replace('.000Z', 'Z');
}
export function plainValue(value: unknown): ConnectorJson {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return `\\x${Buffer.from(value).toString('hex')}`;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'bigint') return numberValue(value);
  if (Array.isArray(value)) return value.map(plainValue);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plainValue(v)]));
  return value as ConnectorJson;
}

/** Rows as they arrive, within the limits: past `rows` it reports `full` (stop reading); past `bytes` it throws. */
export class Collector {
  readonly rows: Record<string, ConnectorJson>[] = [];
  truncated = false;
  private bytes = 2;
  constructor(readonly limits: ConnectorLimits, readonly columns: ConnectorColumn[] = []) {}
  /** Adds one row; false once the answer is full (one more row than the limit was seen). */
  add(row: Record<string, ConnectorJson>): boolean {
    if (this.rows.length >= this.limits.rows) { this.truncated = true; return false; }
    this.bytes += Buffer.byteLength(JSON.stringify(row)) + 1;
    if (this.bytes > this.limits.bytes) throw new ConnectorFailure('result_too_large', `an answer is at most ${this.limits.bytes} bytes; select fewer rows or columns`);
    this.rows.push(row);
    return true;
  }
  answer(): ConnectorAnswer { return { columns: this.columns, rows: this.rows, ...(this.truncated ? { truncated: true as const } : {}) }; }
}

/** Column names must be unique for rows keyed by name: a repeated one is refused, naming it. */
export function uniqueColumns(columns: { name: string; type: ConnectorValueType }[]): ConnectorColumn[] {
  const seen = new Set<string>();
  for (const c of columns) {
    if (seen.has(c.name)) throw new ConnectorFailure('invalid_query', `the column name ${JSON.stringify(c.name)} appears twice; give one an alias`);
    seen.add(c.name);
  }
  return columns;
}

/** Runs `work` within the wall time: past it, `onTimeout` (close the session) and `timeout`. */
export async function withinTime<T>(ms: number, signal: AbortSignal | undefined, onTimeout: () => void, work: () => Promise<T>): Promise<T> {
  if (signal?.aborted) throw new ConnectorFailure('timeout', 'the query was cancelled');
  let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
  const stop = new Promise<never>((_, reject) => {
    const fail = (message: string) => { onTimeout(); reject(new ConnectorFailure('timeout', message)); };
    timer = setTimeout(() => fail('the query ran past its time limit'), ms);
    abort = () => fail('the query was cancelled');
    signal?.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([work(), stop]); }
  finally { clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); }
}
