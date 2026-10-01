/**
 * WHERE AN EDITOR DRAFT IS COMPILED. `renderDraftPreview` is whole-document, CPU-bound work; on the
 * request thread a heavy document's compile holds every other request this process answers. So a
 * draft compiles on a worker thread (./draft-compile-pool.ts) whenever this process carries the
 * worker's entry: the bundled `draft-compile-worker.mjs` beside the server bundle, or — in
 * development — the TypeScript source under tsx. A process without it (tests, a bundle that did not
 * emit the entry) compiles in-process, one at a time.
 *
 * Either way every draft passes the admission gate (./draft-compile-gate.ts): one running and one
 * waiting compile per editor session, a small global cap, and a short bounded wait.
 */
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { IS_DEV } from '@/lib/config';
import { createDraftCompileGate, type DraftCompileGate } from './draft-compile-gate';
import { createDraftCompilePool, type DraftCompilePool } from './draft-compile-pool';
import { renderDraftPreview } from './draft-preview.server';
import type { PrepareStoryInput } from './prepare-runtime.server';

/** How long an eligible draft may wait for a compile slot before it is answered busy. */
export const DRAFT_COMPILE_WAIT_MS = 2_000;
/** Compiles running at once across every session when they run on worker threads. */
const MAX_WORKER_COMPILES = 3;

/** The worker's entry: a bundle's emitted file beside this module, else the source under tsx in development. */
function workerEntry(): { url: URL; execArgv?: string[] } | null {
  const bundled = new URL('./draft-compile-worker.mjs', import.meta.url);
  if (existsSync(fileURLToPath(bundled))) return { url: bundled };
  if (!IS_DEV) return null;
  const dev = new URL('./draft-compile-worker-dev.mjs', import.meta.url);
  return existsSync(fileURLToPath(dev)) ? { url: dev, execArgv: [] } : null;
}

let pool: DraftCompilePool | null | undefined;
let gate: DraftCompileGate | null = null;

function compilePool(): DraftCompilePool | null {
  if (pool !== undefined) return pool;
  const entry = workerEntry();
  pool = entry ? createDraftCompilePool({ ...entry, workers: Math.max(1, availableParallelism() - 1) }) : null;
  return pool;
}

/** The process's admission gate for draft compiles. */
export function draftCompileGate(): DraftCompileGate {
  if (gate) return gate;
  const workers = compilePool()?.size ?? 0;
  gate = workers
    ? createDraftCompileGate({ concurrency: Math.min(MAX_WORKER_COMPILES, workers), waitMs: DRAFT_COMPILE_WAIT_MS })
    // On the request thread: one at a time, and after each the thread is left to other requests for as long
    // as the compile held it (up to a second), so pages and saves keep being answered between drafts.
    : createDraftCompileGate({ concurrency: 1, waitMs: DRAFT_COMPILE_WAIT_MS, restMs: (ms) => Math.min(ms, 1_000) });
  return gate;
}

/** Compile one admitted draft: on a worker thread when this process has them, else in-process. */
export function compileDraft(input: PrepareStoryInput): Promise<string> {
  const threads = compilePool();
  return threads ? threads.compile(input) : renderDraftPreview(input);
}
