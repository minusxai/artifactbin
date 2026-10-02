/**
 * THE PROCESS'S PREPARE THREADS (./draft-compile-pool.ts): one bounded pool for every CPU-bound
 * document job — an editor draft's preview (./draft-compile.server.ts), a version's page compile
 * (./prepared-page.server.ts) and a guest snapshot's drawn charts (lib/compiled-page/snapshots.server).
 * Started from the worker's entry when this process carries it: the bundled `draft-compile-worker.mjs`
 * beside the server bundle, or — in development — the TypeScript source under tsx. Without it (tests,
 * a bundle that did not emit the entry) `prepareWorkers()` is null and callers run the work in-process.
 *
 * Imports no compiler: modules every artifact reader loads may ask for the pool.
 */
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { IS_DEV } from '@/lib/platform/config';
import { createDraftCompilePool, type DraftCompilePool } from './draft-compile-pool';

/** The worker's entry: a bundle's emitted file beside this module, else the source under tsx in development. */
function workerEntry(): { url: URL; execArgv?: string[] } | null {
  const bundled = new URL('./draft-compile-worker.mjs', import.meta.url);
  if (existsSync(fileURLToPath(bundled))) return { url: bundled };
  if (!IS_DEV) return null;
  const dev = new URL('./draft-compile-worker-dev.mjs', import.meta.url);
  return existsSync(fileURLToPath(dev)) ? { url: dev, execArgv: [] } : null;
}

let pool: DraftCompilePool | null | undefined;

function compilePool(): DraftCompilePool | null {
  if (pool !== undefined) return pool;
  const entry = workerEntry();
  pool = entry ? createDraftCompilePool({ ...entry, workers: Math.max(1, availableParallelism() - 1) }) : null;
  return pool;
}

/**
 * The process's one bounded pool of prepare threads, or null when this process has no worker entry
 * (then the caller runs the work in-process, as before).
 */
export function prepareWorkers(): DraftCompilePool | null { return compilePool(); }

/** Tests: run prepare work on threads started from `entry` (null: in-process). Closes any pool already started. */
export async function usePrepareWorkers(entry: { url: URL; execArgv?: string[]; workers?: number } | null): Promise<void> {
  const previous = pool;
  pool = entry ? createDraftCompilePool({ url: entry.url, ...(entry.execArgv ? { execArgv: entry.execArgv } : {}), workers: entry.workers ?? 1 }) : null;
  await previous?.close();
}

