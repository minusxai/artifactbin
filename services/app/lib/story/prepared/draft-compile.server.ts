/**
 * WHERE AN EDITOR DRAFT IS COMPILED — and a version's page compile and its snapshot's drawn charts
 * (`prepareWorkers`: prepared-page.server, snapshots.server). Each is whole-document, CPU-bound work; on
 * the request thread a heavy document's compile or chart set holds every other request this process
 * answers. So it runs on a worker thread (./draft-compile-pool.ts) whenever this process carries the
 * worker's entry: the bundled `draft-compile-worker.mjs` beside the server bundle, or — in
 * development — the TypeScript source under tsx. A process without it (tests, a bundle that did not
 * emit the entry) compiles in-process, one at a time.
 *
 * Either way every draft passes the admission gate (./draft-compile-gate.ts): one running and one
 * waiting compile per editor session, a small global cap, and a short bounded wait.
 */
import { createDraftCompileGate, type DraftCompileGate } from './draft-compile-gate';
import { prepareWorkers } from './prepare-workers.server';
import { renderDraftPreview } from './draft-preview.server';
import type { PrepareStoryInput } from './prepare-runtime.server';

/** How long an eligible draft may wait for a compile slot before it is answered busy. */
const DRAFT_COMPILE_WAIT_MS = 2_000;
/** Compiles running at once across every session when they run on worker threads. */
const MAX_WORKER_COMPILES = 3;

let gate: DraftCompileGate | null = null;
let gateWorkers = -1;

/** The process's admission gate for draft compiles (rebuilt when the pool it was sized for changes). */
export function draftCompileGate(): DraftCompileGate {
  if (gate && gateWorkers === (prepareWorkers()?.size ?? 0)) return gate;
  gateWorkers = prepareWorkers()?.size ?? 0;
  const workers = prepareWorkers()?.size ?? 0;
  gate = workers
    ? createDraftCompileGate({ concurrency: Math.min(MAX_WORKER_COMPILES, workers), waitMs: DRAFT_COMPILE_WAIT_MS })
    // On the request thread: one at a time, and after each the thread is left to other requests for as long
    // as the compile held it (up to a second), so pages and saves keep being answered between drafts.
    : createDraftCompileGate({ concurrency: 1, waitMs: DRAFT_COMPILE_WAIT_MS, restMs: (ms) => Math.min(ms, 1_000) });
  return gate;
}

/** Compile one admitted draft: on a worker thread when this process has them, else in-process. */
export function compileDraft(input: PrepareStoryInput): Promise<string> {
  const threads = prepareWorkers();
  return threads ? threads.compile(input) : renderDraftPreview(input);
}
