/**
 * Select document versions by recorded build metadata, then ask the running app to recompile them.
 * A SEPARATE ENTRY (@/lib/compiled-page/backfill.server) for scripts/compiled-backfill alone: no server
 * code uses it, so the index does not carry it.
 */
import { READER_MODE_HEADER } from './contract';

interface BackfillDb { query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: R[] }> }
export type BackfillColumn = 'compiler_version' | 'island_build' | 'css_version' | 'ssr_bundle' | 'page_format' | 'handover_contract';
export interface BackfillFilter { column: BackfillColumn; op: '!=' | '=' | '<'; value: string | number }
/** A filter, or a group of which any one may match (`--stale`: an old contract OR an old stylesheet). */
export type BackfillSelector = BackfillFilter | { any: readonly BackfillFilter[] };
export interface BackfillOptions {
  db: BackfillDb;
  base: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  mintKey: (artifactId: string) => string;
  all?: boolean;
  concurrency?: number;
  limit?: number;
  dryRun?: boolean;
  timeoutMs?: number;
  filters?: readonly BackfillSelector[];
  log?: (line: string) => void;
  /**
   * Self-pacing: before each version, the server's `/api/health` is asked; while it answers slower than
   * this (ms), or not at all, no new version is sent (waits 1 s, doubling to 10 s). 0 turns it off.
   * Default 500.
   */
  healthMs?: number;
  /** The pause between health checks (tests). */
  sleep?: (ms: number) => Promise<void>;
}
interface BackfillTarget { id: string; version: number; head: boolean }
export interface BackfillReport {
  considered: number;
  done: number;
  warmed: number;
  compiled: number;
  errors: Array<BackfillTarget & { error: string }>;
  build: string | null;
  suffix: string | null;
  census: { stored: number; compiled: number; failures: Record<string, number>; missing: number } | null;
}
interface StoredState {
  page_key: string;
  reason: string | null;
  compiled: boolean;
  compiler_version: string | null;
  island_build: string | null;
  css_version: string | null;
  ssr_bundle: string | null;
  page_format: number | null;
  handover_contract: number | null;
}
const slotOf = (t: BackfillTarget): string => t.head ? 'head' : `v:${t.version}`;
const keyOf = (id: string, slot: string): string => `${id}\0${slot}`;

async function targetsOf(db: BackfillDb, all: boolean, limit: number): Promise<BackfillTarget[]> {
  const heads = (await db.query<{ id: string; version: number }>(
    `SELECT id, version FROM artifacts WHERE format = 'markup' AND deleted_at IS NULL ORDER BY updated_at DESC, id LIMIT $1`, [limit],
  )).rows.map((r) => ({ id: r.id, version: Number(r.version), head: true }));
  if (!all) return heads;
  const archived = (await db.query<{ id: string; version: number }>(
    `SELECT v.artifact_id AS id, v.version FROM artifact_versions v JOIN artifacts a ON a.id = v.artifact_id
     WHERE a.format = 'markup' AND a.deleted_at IS NULL AND v.version <> a.version
     ORDER BY a.updated_at DESC, v.artifact_id, v.version DESC LIMIT $1`, [limit],
  )).rows.map((r) => ({ id: r.id, version: Number(r.version), head: false }));
  return [...heads, ...archived].slice(0, limit);
}
async function storedState(db: BackfillDb): Promise<Map<string, StoredState>> {
  const rows = (await db.query<StoredState & { artifact_id: string; slot: string }>(
    `SELECT artifact_id, slot, page_key, compiler_version, island_build, css_version, ssr_bundle, page_format, handover_contract,
     page ? 'compiled' AS compiled, page->'compiled'->>'reason' AS reason FROM prepared_pages`,
  )).rows;
  return new Map(rows.map((row) => [keyOf(row.artifact_id, row.slot), row]));
}
function matchesFilter(row: StoredState | undefined, { column, op, value }: BackfillFilter): boolean {
  const actual = row?.[column] ?? null;
  if (op === '!=') return actual !== value;
  if (op === '=') return actual === value;
  return actual === null || Number(actual) < Number(value);
}
export function matchesBackfillFilters(row: StoredState | undefined, filters: readonly BackfillSelector[]): boolean {
  if (!filters.length) return !row?.compiled;
  return filters.every((filter) => ('any' in filter ? filter.any.some((one) => matchesFilter(row, one)) : matchesFilter(row, filter)));
}
type Outcome = { kind: 'compiled' } | { kind: 'error'; error: string };
async function warm(options: BackfillOptions, target: BackfillTarget, recompile: boolean): Promise<Outcome> {
  const url = new URL(`/a/${encodeURIComponent(target.id)}/raw`, options.base);
  if (!target.head) url.searchParams.set('version', String(target.version));
  url.searchParams.set('key', options.mintKey(target.id));
  try {
    const response = await options.fetch(url.href, {
      headers: { accept: 'text/html', ...(recompile ? { 'x-mx-compiled-backfill': 'recompile' } : {}) },
      signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
    });
    await response.arrayBuffer();
    if (response.status !== 200) return { kind: 'error', error: `HTTP ${response.status}` };
    return response.headers.get(READER_MODE_HEADER) === 'compiled' ? { kind: 'compiled' } : { kind: 'error', error: 'unexpected reader mode' };
  } catch (error) { return { kind: 'error', error: error instanceof Error ? error.message : String(error) }; }
}
/** Wait until the server answers its health check within `healthMs`: a backfill never adds load to a struggling server. */
async function paced(options: BackfillOptions, report: { paused: number }): Promise<void> {
  const limit = options.healthMs ?? 500;
  if (limit <= 0) return;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let wait = 1_000; ; wait = Math.min(wait * 2, 10_000)) {
    const began = performance.now();
    let healthy = false;
    try {
      const response = await options.fetch(new URL('/api/health', options.base).href, { signal: AbortSignal.timeout(Math.max(limit * 4, 2_000)) });
      await response.arrayBuffer();
      healthy = response.ok && performance.now() - began <= limit;
    } catch { /* no answer: unhealthy */ }
    if (healthy) return;
    if (report.paused++ % 10 === 0) options.log?.(`server health slower than ${limit} ms: pausing ${wait} ms`);
    await sleep(wait);
  }
}

export async function backfillCompiledPages(options: BackfillOptions): Promise<BackfillReport> {
  const all = await targetsOf(options.db, !!options.all, Math.max(1, Math.min(options.limit ?? 1_000_000, 10_000_000)));
  const before = await storedState(options.db);
  const filters = options.filters ?? [];
  const selected = all.filter((target) => matchesBackfillFilters(before.get(keyOf(target.id, slotOf(target))), filters));
  const report: BackfillReport = { considered: selected.length, done: all.length - selected.length, warmed: 0, compiled: 0, errors: [], build: null, suffix: null, census: null };
  options.log?.(`${selected.length} version(s) selected; ${report.done} skipped`);
  if (options.dryRun) return report;
  let next = 0;
  const pacing = { paused: 0 };
  const worker = async (): Promise<void> => {
    while (next < selected.length) {
      await paced(options, pacing);
      if (next >= selected.length) return;
      const target = selected[next++]!;
      const outcome = await warm(options, target, !!before.get(keyOf(target.id, slotOf(target)))?.compiled);
      report.warmed++;
      if (outcome.kind === 'compiled') report.compiled++;
      else report.errors.push({ ...target, error: outcome.error });
      if (report.warmed % 100 === 0) options.log?.(`${report.warmed} warmed (${report.compiled} compiled, ${report.errors.length} errors)`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 3, 32)) }, worker));
  const after = await storedState(options.db);
  const census = { stored: 0, compiled: 0, failures: {} as Record<string, number>, missing: 0 };
  for (const target of selected) {
    const row = after.get(keyOf(target.id, slotOf(target)));
    if (!row?.compiled || row.page_key !== `v:${target.version}`) { census.missing++; continue; }
    census.stored++;
    if (row.reason) census.failures[row.reason] = (census.failures[row.reason] ?? 0) + 1;
    else census.compiled++;
  }
  report.census = census;
  return report;
}
