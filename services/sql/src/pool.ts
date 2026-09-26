/**
 * THE SQLITE ENGINE ON A SERVER: `@artifactbin/sql/core` in a few worker
 * threads behind the `SqlService` contract. The engine is synchronous — a
 * statement holds the thread it runs on until it finishes or its deadline
 * interrupts it — so a server never runs it on its own event loop: every call
 * goes to an idle thread (or waits for one), and `/health`, the app's routes
 * and every other request keep being answered while a query runs.
 *
 * The deadline is enforced inside the thread (the engine's progress handler).
 * A thread that does not answer within a grace period past it — wedged,
 * crashed, out of memory — is terminated and replaced, and its caller gets a
 * timed-out failure, never a hang.
 */
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { DryRunInput, DryRunMutationsInput, DryRunMutationsResult, DryRunResult, MutationInput, MutationOutcome, QueryOutcome, RunInput, SqlService } from '@artifactbin/contracts';
import { queryBounds } from './bounds';
import { DEFAULT_CAPS, type SqlCaps } from './caps';
import type { ReadBounds, WriteBounds } from './sqlite/index';

export type PoolRequest =
  | { id: number; method: 'run'; input: RunInput; bounds: ReadBounds }
  | { id: number; method: 'mutate'; input: MutationInput; bounds: WriteBounds }
  | { id: number; method: 'dryRun'; input: DryRunInput }
  | { id: number; method: 'dryRunMutations'; input: DryRunMutationsInput };
export type PoolAnswer = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

export interface SqlPoolOptions {
  /** Engine threads; a few, never more than the machine has cores for. */
  workers?: number;
  /** A module whose default export is the composition root's `SqlExtensions`, imported by every thread. */
  extensions?: string;
  /** How long past a call's own deadline a silent thread is given before it is replaced. */
  graceMs?: number;
  /** The thread entry; the bundled `pool-worker.mjs` beside this module, else its source under tsx. */
  workerUrl?: URL;
}

/** The thread entry: a bundle's emitted `pool-worker.mjs` beside this file, else the TypeScript source (development, tests). */
function workerEntry(): { url: URL; execArgv?: string[] } {
  const bundled = new URL('./pool-worker.mjs', import.meta.url);
  if (existsSync(fileURLToPath(bundled))) return { url: bundled };
  const source = new URL('./pool-worker.ts', import.meta.url);
  // Running from source: the thread needs the same TypeScript loader its parent has.
  return { url: source, ...(process.execArgv.some((a) => a.includes('tsx')) ? {} : { execArgv: [...process.execArgv, '--import', 'tsx'] }) };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
interface Task { request: PoolRequest; deadlineMs: number; settle: (answer: PoolAnswer) => void }
interface Thread { worker: Worker; ready: Promise<void>; task: Task | null; timer: ReturnType<typeof setTimeout> | null }

export function createSqlitePool(opts: Partial<SqlCaps> = {}, pool: SqlPoolOptions = {}): SqlService & { close(): Promise<void> } {
  const caps: SqlCaps = { ...DEFAULT_CAPS, ...opts };
  const size = Math.max(1, pool.workers ?? Math.min(4, Math.max(1, availableParallelism() - 1)));
  const grace = pool.graceMs ?? 2_000;
  const entry = pool.workerUrl ? { url: pool.workerUrl } : workerEntry();
  const threads: Thread[] = [];
  const queue: Task[] = [];
  let ids = 0;
  let closed = false;

  const spawn = (): Thread => {
    const worker = new Worker(entry.url, { ...(entry.execArgv ? { execArgv: entry.execArgv } : {}), workerData: { extensions: pool.extensions } });
    const thread: Thread = { worker, task: null, timer: null, ready: new Promise((resolve, reject) => {
      const onReady = (m: unknown) => { if ((m as { ready?: boolean })?.ready) { worker.off('message', onReady); resolve(); } };
      worker.on('message', onReady);
      worker.once('error', reject);
    }) };
    thread.ready.catch(() => {}); // a thread that fails to start fails its task through `fail` below
    worker.on('message', (answer: PoolAnswer | { ready: true }) => {
      if (!('id' in answer) || thread.task?.request.id !== answer.id) return;
      finish(thread, answer);
    });
    const fail = (why: string) => {
      const task = thread.task;
      retire(thread);
      if (task) task.settle({ id: task.request.id, ok: false, error: why });
      pump();
    };
    worker.on('error', (e) => fail(`the SQL engine failed: ${e.message}`));
    worker.on('exit', () => { if (threads.includes(thread)) fail('the SQL engine stopped'); });
    worker.unref();
    threads.push(thread);
    return thread;
  };

  const retire = (thread: Thread) => {
    const i = threads.indexOf(thread);
    if (i >= 0) threads.splice(i, 1);
    if (thread.timer) clearTimeout(thread.timer);
    thread.task = null;
    void thread.worker.terminate();
  };

  const finish = (thread: Thread, answer: PoolAnswer) => {
    const task = thread.task!;
    if (thread.timer) clearTimeout(thread.timer);
    thread.timer = null;
    thread.task = null;
    thread.worker.unref();
    task.settle(answer);
    pump();
  };

  const pump = () => {
    while (queue.length && !closed) {
      const idle = threads.find((t) => !t.task) ?? (threads.length < size ? spawn() : null);
      if (!idle) return;
      const task = queue.shift()!;
      idle.task = task;
      idle.worker.ref();
      void idle.ready.then(() => {
        if (idle.task !== task) return;
        idle.worker.postMessage(task.request);
        idle.timer = setTimeout(() => {
          // Silent past its own deadline: the thread is wedged. Replace it.
          retire(idle);
          task.settle({ id: task.request.id, ok: false, error: 'timed_out' });
          pump();
        }, task.deadlineMs + grace);
      }, () => {});
    }
  };

  const call = <T>(request: DistributiveOmit<PoolRequest, 'id'>, deadlineMs: number, onError: (error: string) => T): Promise<T> => {
    if (closed) return Promise.resolve(onError('the SQL engine is closed'));
    return new Promise<T>((resolve) => {
      queue.push({ request: { ...request, id: ++ids } as PoolRequest, deadlineMs, settle: (a) => resolve(a.ok ? a.result as T : onError(a.error)) });
      pump();
    });
  };

  const timedOut = (error: string) => error === 'timed_out';
  return {
    run: (input) => {
      const { limit, timeoutMs } = queryBounds(input, caps);
      const bounds: ReadBounds = { limit, timeoutMs, pageLimit: queryBounds(input, caps, input.page).limit };
      return call<Record<string, QueryOutcome>>({ method: 'run', input, bounds }, timeoutMs * Math.max(1, input.queries.length),
        (error) => Object.fromEntries(input.queries.map((q) => [q.name, timedOut(error) ? { error: `<Query name="${q.name}"> ran too long and was stopped (limit ${timeoutMs}ms) — narrow it (filter, aggregate, or LIMIT)`, timedOut: true } : { error }])));
    },
    mutate: (input) => {
      const bounds = queryBounds(input, caps);
      return call<MutationOutcome>({ method: 'mutate', input, bounds }, bounds.timeoutMs,
        (error) => (timedOut(error) ? { error: `the mutation ran too long and was stopped (limit ${bounds.timeoutMs}ms)`, timedOut: true } : { error }));
    },
    dryRun: (input) => call<DryRunResult>({ method: 'dryRun', input }, caps.timeoutMs * Math.max(1, input.queries.length),
      (error) => ({ errors: input.queries.map((q) => ({ name: q.name, error })), columns: {} })),
    dryRunMutations: (input) => call<DryRunMutationsResult>({ method: 'dryRunMutations', input }, caps.timeoutMs * Math.max(1, input.mutations.length),
      (error) => ({ errors: input.mutations.map((m) => ({ name: m.name, error })) })),
    close: async () => {
      closed = true;
      for (const task of queue.splice(0)) task.settle({ id: task.request.id, ok: false, error: 'the SQL engine is closed' });
      await Promise.all([...threads].map((t) => { retire(t); return t.worker.terminate(); }));
    },
  };
}
