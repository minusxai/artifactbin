/**
 * THE COMPILED-PAGE BACKFILL (scripts/compiled-backfill.ts; docs/phase2-architecture.md §6.1).
 *
 * Every live document head — and with `all`, every archived version — gets its compiled page stored
 * beside its prepared page, so the first reader after a deploy is a hit instead of a compile.
 *
 * THE RUNNING SERVER DOES THE WORK. A prepared page is stored under a key that digests the SERVING
 * process's own code (lib/story/prepared-page.server `keyOf`: the server bundle, the CSS compile
 * version and the compiler build). A compile made by this script's process would carry this script's
 * digest, and every row it wrote would miss on the server's first read and be rebuilt there. So, like
 * the Mermaid backfill (which only queues what the server's harvester draws), this only DECIDES what
 * to warm; each version is prepared and compiled by the server itself, through its own reader door —
 * `GET /a/<id>/raw[?version=N]` admitted by a short-lived export key (the exporter's
 * credential: no session, no view counted, the owner's history scope for an archived version). The
 * reader's default chrome is kept on purpose: `chrome=0` with a key is a capture, which would run
 * every document's queries.
 *
 * IDEMPOTENT AND RESUMABLE. The first warmed version shows what this deployment writes: its stored
 * `page_key` ends with the deployment's suffix (CSS version, server build, compiler build). A version
 * whose stored entry already ends with it is done — a compile, or a failure recorded by this build —
 * and is skipped; a second run warms nothing. Concurrency is bounded; a dry run reads and counts only.
 *
 * Success is the server's own answer (`x-mx-reader: compiled`, no fallback header). A server whose
 * switch is `off` compiles nothing and answers `legacy` without a reason: the run stops there rather
 * than report a no-op as done. The census at the end is read from the database, not from the run.
 */
import { READER_FALLBACK_HEADER, READER_MODE_HEADER } from './contract';

/** What the backfill reads and writes through: the app's database (lib/db). */
export interface BackfillDb { query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: R[] }> }

export interface BackfillOptions {
  db: BackfillDb;
  /** The running server's origin (its `APP__PUBLIC_BASE_URL`, or its loopback address on the host). */
  base: string;
  /** How a request reaches the server (global `fetch` in the script; the app's own handler in tests). */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** An export key for one artifact, minted under the SERVER's secret (lib/export-key mintExportKey). */
  mintKey: (artifactId: string) => string;
  /** Archived versions too, not only the heads. */
  all?: boolean;
  /** Versions warmed at once (default 3). */
  concurrency?: number;
  /** At most this many versions considered, newest first. */
  limit?: number;
  /** Count what would be warmed; warm nothing. */
  dryRun?: boolean;
  /** One version's request timeout (default 180 s: the largest stored document compiles in ~12 s). */
  timeoutMs?: number;
  log?: (line: string) => void;
}

/** One document version, as the backfill addresses it. */
export interface BackfillTarget { id: string; version: number; head: boolean }

export interface BackfillReport {
  /** Versions considered (live markup heads, plus archived versions with `all`). */
  considered: number;
  /** Already stored by this deployment: skipped. */
  done: number;
  /** Requests made (the probe included). */
  warmed: number;
  /** Warmed and served compiled. */
  compiled: number;
  /** Warmed and answered by today's renderer, by the reason the server named. */
  fallbacks: Record<string, number>;
  /** Warmed and failed (an HTTP error or a timeout). */
  errors: Array<{ id: string; version: number; head: boolean; error: string }>;
  /** The deployment's compiler build and prepared-page key suffix, when a probe learned them. */
  build: string | null;
  suffix: string | null;
  /** From the database after the run, over the versions considered. */
  census: { stored: number; compiled: number; failures: Record<string, number>; missing: number } | null;
}

const slotOf = (target: BackfillTarget): string => (target.head ? 'head' : `v:${target.version}`);
const keyOf = (target: Pick<BackfillTarget, 'id'> & { slot: string }): string => `${target.id}\u0000${target.slot}`;

/** Live markup heads (newest first), and with `all` their archived versions other than the head. */
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

/** Every stored prepared page's key and compile state, by artifact and slot. */
async function storedState(db: BackfillDb): Promise<Map<string, { pageKey: string; build: string | null; reason: string | null }>> {
  const rows = (await db.query<{ artifact_id: string; slot: string; page_key: string; build: string | null; reason: string | null }>(
    `SELECT artifact_id, slot, page_key, page->'compiled'->>'build' AS build, page->'compiled'->>'reason' AS reason FROM prepared_pages`,
  )).rows;
  return new Map(rows.map((r) => [keyOf({ id: r.artifact_id, slot: r.slot }), { pageKey: r.page_key, build: r.build, reason: r.reason }]));
}

/**
 * The deployment's part of a prepared-page key: everything after the row digest
 * (`<format>:<row sha>:<css version>:<server build>:<compiler build>`, lib/story/prepared-page.server keyOf).
 */
const suffixOf = (pageKey: string): string => pageKey.split(':').slice(2).join(':');

type Outcome = { kind: 'compiled' } | { kind: 'fallback'; reason: string } | { kind: 'error'; error: string };

/** Ask the server to prepare and compile one version, as its reader would be served. */
async function warm(options: BackfillOptions, target: BackfillTarget): Promise<Outcome> {
  const url = new URL(`/a/${encodeURIComponent(target.id)}/raw`, options.base);
  if (!target.head) url.searchParams.set('version', String(target.version));
  // Minted right before its request: the key lives for a minute.
  url.searchParams.set('key', options.mintKey(target.id));
  try {
    const res = await options.fetch(url.href, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(options.timeoutMs ?? 180_000) });
    await res.arrayBuffer();
    if (res.status !== 200) return { kind: 'error', error: `HTTP ${res.status}` };
    const reason = res.headers.get(READER_FALLBACK_HEADER);
    if (reason) return { kind: 'fallback', reason };
    return res.headers.get(READER_MODE_HEADER) === 'compiled' ? { kind: 'compiled' } : { kind: 'error', error: 'unexpected reader mode' };
  } catch (error) {
    return { kind: 'error', error: error instanceof Error ? error.message : String(error) };
  }
}

export async function backfillCompiledPages(options: BackfillOptions): Promise<BackfillReport> {
  const log = options.log ?? (() => {});
  const targets = await targetsOf(options.db, !!options.all, Math.max(1, Math.min(options.limit ?? 1_000_000, 10_000_000)));
  const report: BackfillReport = { considered: targets.length, done: 0, warmed: 0, compiled: 0, fallbacks: {}, errors: [], build: null, suffix: null, census: null };
  if (!targets.length) return report;
  const record = (target: BackfillTarget, outcome: Outcome): void => {
    report.warmed += 1;
    if (outcome.kind === 'compiled') report.compiled += 1;
    else if (outcome.kind === 'fallback') report.fallbacks[outcome.reason] = (report.fallbacks[outcome.reason] ?? 0) + 1;
    else if (outcome.kind === 'error') report.errors.push({ ...target, error: outcome.error });
  };

  let stored = await storedState(options.db);
  if (options.dryRun) {
    // Without a probe the deployment's suffix is unknown: a version is counted done only when a stored
    // compile names the compiler build most stored compiles name — an estimate, reported as one.
    const builds = new Map<string, number>();
    for (const s of stored.values()) if (s.build) builds.set(s.build, (builds.get(s.build) ?? 0) + 1);
    const build = [...builds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    report.build = build;
    report.done = targets.filter((t) => build && stored.get(keyOf({ id: t.id, slot: slotOf(t) }))?.build === build).length;
    log(`dry run: ${report.considered} version(s), ~${report.done} already compiled by build ${build ?? '(none)'}, ~${report.considered - report.done} to warm`);
    return report;
  }

  // The probe: the first version, warmed whatever its state, teaches the deployment's key suffix.
  const [probe, ...rest] = targets;
  const first = await warm(options, probe!);
  record(probe!, first);
  if (first.kind === 'error') throw new Error(`the server at ${options.base} could not warm ${probe!.id}: ${first.error}`);
  stored = await storedState(options.db);
  const probed = stored.get(keyOf({ id: probe!.id, slot: slotOf(probe!) }));
  if (!probed) throw new Error(`the server at ${options.base} stored no prepared page for ${probe!.id}: is --db the server's database?`);
  report.suffix = suffixOf(probed.pageKey);
  report.build = probed.pageKey.split(':').at(-1) ?? null;
  log(`deployment ${report.suffix}; ${targets.length} version(s) considered`);

  const todo = rest.filter((t) => {
    const s = stored.get(keyOf({ id: t.id, slot: slotOf(t) }));
    const done = !!s && suffixOf(s.pageKey) === report.suffix && s.build === report.build;
    if (done) report.done += 1;
    return !done;
  });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const target = todo[next++]!;
      record(target, await warm(options, target));
      if (report.warmed % 100 === 0) log(`${report.warmed} warmed (${report.compiled} compiled, ${report.errors.length} errors)`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 3, 32)) }, worker));

  // The census, from what is stored now.
  stored = await storedState(options.db);
  const census = { stored: 0, compiled: 0, failures: {} as Record<string, number>, missing: 0 };
  for (const t of targets) {
    const s = stored.get(keyOf({ id: t.id, slot: slotOf(t) }));
    if (!s || suffixOf(s.pageKey) !== report.suffix || s.build !== report.build) { census.missing += 1; continue; }
    census.stored += 1;
    if (s.reason) census.failures[s.reason] = (census.failures[s.reason] ?? 0) + 1;
    else census.compiled += 1;
  }
  report.census = census;
  return report;
}
