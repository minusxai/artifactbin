/** Select document versions by recorded build metadata, then ask the running app to recompile them. */
import { READER_FALLBACK_HEADER, READER_MODE_HEADER } from './contract';

export interface BackfillDb { query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: R[] }> }
export type BackfillColumn = 'compiler_version' | 'island_build' | 'css_version' | 'ssr_bundle' | 'page_format' | 'handover_contract';
export interface BackfillFilter { column: BackfillColumn; op: '!=' | '=' | '<'; value: string | number }
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
  filters?: readonly BackfillFilter[];
  log?: (line: string) => void;
}
export interface BackfillTarget { id: string; version: number; head: boolean }
export interface BackfillReport {
  considered: number;
  done: number;
  warmed: number;
  compiled: number;
  fallbacks: Record<string, number>;
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
export function matchesBackfillFilters(row: StoredState | undefined, filters: readonly BackfillFilter[]): boolean {
  if (!filters.length) return !row?.compiled;
  return filters.every(({ column, op, value }) => {
    const actual = row?.[column] ?? null;
    if (op === '!=') return actual !== value;
    if (op === '=') return actual === value;
    return actual === null || Number(actual) < Number(value);
  });
}
type Outcome = { kind: 'compiled' } | { kind: 'fallback'; reason: string } | { kind: 'error'; error: string };
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
    const reason = response.headers.get(READER_FALLBACK_HEADER);
    if (reason) return { kind: 'fallback', reason };
    return response.headers.get(READER_MODE_HEADER) === 'compiled' ? { kind: 'compiled' } : { kind: 'error', error: 'unexpected reader mode' };
  } catch (error) { return { kind: 'error', error: error instanceof Error ? error.message : String(error) }; }
}
export async function backfillCompiledPages(options: BackfillOptions): Promise<BackfillReport> {
  const all = await targetsOf(options.db, !!options.all, Math.max(1, Math.min(options.limit ?? 1_000_000, 10_000_000)));
  const before = await storedState(options.db);
  const filters = options.filters ?? [];
  const selected = all.filter((target) => matchesBackfillFilters(before.get(keyOf(target.id, slotOf(target))), filters));
  const report: BackfillReport = { considered: selected.length, done: all.length - selected.length, warmed: 0, compiled: 0, fallbacks: {}, errors: [], build: null, suffix: null, census: null };
  options.log?.(`${selected.length} version(s) selected; ${report.done} skipped`);
  if (options.dryRun) return report;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < selected.length) {
      const target = selected[next++]!;
      const outcome = await warm(options, target, !!before.get(keyOf(target.id, slotOf(target)))?.compiled);
      report.warmed++;
      if (outcome.kind === 'compiled') report.compiled++;
      else if (outcome.kind === 'fallback') report.fallbacks[outcome.reason] = (report.fallbacks[outcome.reason] ?? 0) + 1;
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
