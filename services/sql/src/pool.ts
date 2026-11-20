/**
 * THE SQLITE ENGINE ON A SERVER: `@artifactbin/sql/core` in a few worker
 * threads behind the `SqlService` contract. The engine is synchronous — a
 * statement holds the thread it runs on until it finishes or its deadline
 * interrupts it — so a server never runs it on its own event loop: every call
 * goes to an idle thread (or waits for one), and `/health`, the app's routes
 * and every other request keep being answered while a query runs.
 *
 * Per-query deadlines are enforced inside the thread (the engine's progress handler).
 * A whole-call deadline starts at admission, including queueing and worker startup.
 * Cancellation removes queued tasks or awaits worker termination before releasing capacity.
 * A thread that does not answer within a grace period past it — wedged,
 * crashed, out of memory — is terminated and replaced, and its caller gets a
 * timed-out failure, never a hang.
 */
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { DryRunInput, DryRunMutationsInput, DryRunMutationsResult, DryRunResult, MutationInput, MutationOutcome, QueryOutcome, RunInput, RunManyInput, SqlService } from '@artifactbin/contracts/sql';
import { SQL_WALL_OVERHEAD_MS, sqlTimeout, type SqlCallContext } from '@artifactbin/contracts/sql';
import { queryBounds } from './bounds';
import { sqlCaps, type SqlCaps } from './caps';
import { preparedKey, type ReadBounds, type WriteBounds } from './sqlite/index';

export type PoolRequest =
  | { id: number; method: 'run'; input: RunInput; bounds: ReadBounds }
  | { id: number; method: 'runMany'; input: RunManyInput; bounds: ReadBounds[] }
  | { id: number; method: 'mutate'; input: MutationInput; bounds: WriteBounds }
  | { id: number; method: 'dryRun'; input: DryRunInput }
  | { id: number; method: 'dryRunMutations'; input: DryRunMutationsInput };
export type PoolAnswer = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

export interface SqlPoolOptions {
  /** Engine threads; a few, never more than the machine has cores for. */
  workers?: number;
  /** A module whose default export is the composition root's `SqlExtensions`, imported by every thread. */
  extensions?: string;
  /** Bytes of prepared catalog databases each thread keeps (./sqlite/prepared); 32 MiB by default. */
  preparedBytes?: number;
  /** How long past a call's own deadline a silent thread is given before it is replaced. */
  graceMs?: number;
  /** The thread entry; the bundled `pool-worker.mjs` beside this module, else its source under tsx. */
  workerUrl?: URL;
}

/** The thread entry: a bundle's emitted `pool-worker.mjs` beside this file, else the TypeScript source (development, tests). */
function workerEntry(): { url: URL; execArgv?: string[] } {
  const bundled = new URL('./pool-worker.mjs', import.meta.url);
  if (existsSync(fileURLToPath(bundled))) return { url: bundled };
  // Register inside the worker: inherited --import flags do not reliably
  // install tsx's resolver before Node's native TypeScript loading begins.
  return { url: new URL('./pool-worker-dev.mjs', import.meta.url), execArgv: [] };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * THE SHAPE THE POOL ITSELF READS. Over HTTP a request is whatever JSON arrived (./index.ts serves it unchecked), and
 * the pool dereferences its arrays outside any awaited chain: the watchdog budget, the affinity key and every failure
 * answer. One missing there killed the process. So each method refuses, before anything is queued or armed, a body
 * whose lists are not lists of objects; the engine judges everything else, inside its thread.
 */
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const objects = (value: unknown): boolean => Array.isArray(value) && value.every(isObject);
const catalogShaped = (catalog: unknown): boolean => catalog == null || (isObject(catalog) && objects(catalog.tables));
const queriesShaped = (run: unknown): boolean => isObject(run) && objects(run.queries);
function wellFormed(method: PoolRequest['method'], input: unknown): boolean {
  if (!isObject(input)) return false;
  switch (method) {
    case 'run': return queriesShaped(input) && catalogShaped(input.catalog);
    case 'runMany': return Array.isArray(input.runs) && input.runs.every(queriesShaped) && (input.shared == null || queriesShaped(input.shared));
    case 'mutate': return input.mounted == null || (isObject(input.mounted) && catalogShaped(input.mounted.catalog));
    case 'dryRun': return queriesShaped(input);
    case 'dryRunMutations': return objects(input.mutations);
  }
}
/** Refuses a malformed request to its caller; the shell answers `bad_request`. */
function admit(method: PoolRequest['method'], input: unknown): void {
  if (!wellFormed(method, input)) throw new TypeError('malformed SQL request');
}
/**
 * `prepared`: the identity of the catalog database a keyed read mounts (./sqlite/prepared), for affinity.
 * `executionMs`: the silent-thread watchdog's budget, fixed when the call is admitted.
 */
interface Task { request: PoolRequest; deadline: number; executionMs: number; prepared: string | null; settle: (answer: PoolAnswer) => void }
/** How many prepared databases the pool remembers a thread for. */
const AFFINITY_ENTRIES = 1024;
interface Thread { retiring?:Promise<void>; worker: Worker; ready: Promise<void>; task: Task | null; timer: ReturnType<typeof setTimeout> | null }

export function createSqlitePool(opts: Partial<SqlCaps> = {}, pool: SqlPoolOptions = {}): SqlService & { close(): Promise<void> } {
  const caps: SqlCaps = sqlCaps(opts);
  const size = Math.max(1, pool.workers ?? Math.min(4, Math.max(1, availableParallelism() - 1)));
  const grace = sqlTimeout(pool.graceMs, 2_000, 5_000, 'cleanup grace');
  const entry = pool.workerUrl ? { url: pool.workerUrl } : workerEntry();
  const threads: Thread[] = [];
  const queue: Task[] = [];
  /**
   * AFFINITY: the thread each prepared catalog database was last sent to, so a repeated keyed read lands where
   * its database is kept. Only a preference: when that thread is busy the read takes any idle one, which at
   * worst answers `rowsRequired` and builds its own copy — never a wait behind another call.
   */
  const affinity = new Map<string, Thread>();
  let ids = 0;
  let closed = false;

  const spawn = (): Thread => {
    const worker = new Worker(entry.url, { ...(entry.execArgv ? { execArgv: entry.execArgv } : {}), workerData: { extensions: pool.extensions, preparedBytes: pool.preparedBytes } });
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
      if(thread.retiring)return;
      const task = thread.task;
      void retire(thread).then(()=>{if(task)task.settle({id:task.request.id,ok:false,error:why});pump();});
    };
    worker.on('error', (e) => fail(`the SQL engine failed: ${e.message}`));
    worker.on('exit', () => { if (threads.includes(thread)) fail('the SQL engine stopped'); });
    worker.unref();
    threads.push(thread);
    return thread;
  };

  const retire = (thread: Thread):Promise<void> => {
    if(thread.retiring)return thread.retiring;
    if(thread.timer)clearTimeout(thread.timer);
    thread.task=null;
    for (const [key, held] of affinity) if (held === thread) affinity.delete(key);
    // Keep the retiring thread counted against capacity until terminate confirms exit.
    thread.retiring=thread.worker.terminate().then(()=>{const i=threads.indexOf(thread);if(i>=0)threads.splice(i,1);});
    return thread.retiring;
  };

  const finish = (thread: Thread, answer: PoolAnswer) => {
    const task = thread.task!;
    if (thread.timer) clearTimeout(thread.timer);
    thread.timer = null;
    thread.task = null;
    thread.worker.unref();
    task.settle(performance.now() >= task.deadline ? {id:task.request.id,ok:false,error:'timed_out'} : answer);
    pump();
  };

  // Twin of services/app/lib/publish/prepared/draft-compile-pool.ts's pump; this one adds a per-task deadline and retires a timed-out thread.
  const pump = () => {
    while (queue.length && !closed) {
      const preferred = queue[0]!.prepared === null ? undefined : affinity.get(queue[0]!.prepared);
      const idle = (preferred && !preferred.task && !preferred.retiring && threads.includes(preferred) ? preferred : null)
        ?? threads.find((t) => !t.task&&!t.retiring) ?? (threads.length < size ? spawn() : null);
      if (!idle) return;
      const task = queue.shift()!;
      if (task.prepared !== null) {
        affinity.delete(task.prepared);
        affinity.set(task.prepared, idle);
        if (affinity.size > AFFINITY_ENTRIES) affinity.delete(affinity.keys().next().value!);
      }
      idle.task = task;
      idle.worker.ref();
      void idle.ready.then(() => {
        if (idle.task !== task) return;
        if (performance.now() >= task.deadline) {
          void retire(idle).then(() => { task.settle({id:task.request.id,ok:false,error:'timed_out'}); pump(); });
          return;
        }
        idle.worker.postMessage(task.request);
        // Retain the execution watchdog for silent workers, bounded by the admission deadline.
        idle.timer = setTimeout(() => {
          void retire(idle).then(() => { task.settle({id:task.request.id,ok:false,error:'timed_out'}); pump(); });
        }, Math.min(task.executionMs + grace, Math.max(1, task.deadline - performance.now())));

      }, () => {});
    }
  };

  /** The watchdog's budget: every statement's own deadline, summed, for the runs share one thread one after another. */
  const executionBudget = (r: DistributiveOmit<PoolRequest, 'id'>): number => r.method === 'run' ? r.bounds.timeoutMs * Math.max(1, r.input.queries.length)
    : r.method === 'runMany' ? r.bounds.reduce((sum, b, i) => sum + b.timeoutMs * Math.max(1, (r.input.runs[i] ?? r.input.shared)?.queries.length ?? 1), 0)
    : r.method === 'mutate' ? r.bounds.timeoutMs : r.method === 'dryRun' ? caps.timeoutMs : caps.mutationTimeoutMs;

  const call = <T>(request: DistributiveOmit<PoolRequest, 'id'>, deadlineMs: number, onError: (error: string) => T, context?: SqlCallContext, started = performance.now()): Promise<T> => {
    deadlineMs = sqlTimeout(context?.wallTimeoutMs, deadlineMs, deadlineMs, 'wallTimeoutMs', true);
    const deadline = started + deadlineMs;
    if (context?.signal?.aborted) return Promise.resolve(onError('SQL call cancelled'));
    if(closed)return Promise.resolve(onError('the SQL engine is closed'));
    // Everything that reads the request is computed here, before the call is queued or its deadline armed.
    const executionMs = executionBudget(request);
    const prepared = request.method==='run'?preparedKey(request.input):request.method==='mutate'&&request.input.mounted?preparedKey({catalog:request.input.mounted.catalog}):null;
    return new Promise<T>(resolve=>{
      let done=false;
      const settle=(answer:PoolAnswer)=>{if(done)return;done=true;clearTimeout(timer);context?.signal?.removeEventListener('abort', abort);resolve(answer.ok?answer.result as T:onError(answer.error));};
      const cancel = (error: string) => {
        const i = queue.indexOf(task);
        if (i >= 0) { queue.splice(i, 1); settle({id:task.request.id,ok:false,error}); return; }
        const thread = threads.find(t => t.task === task);
        if (thread) void retire(thread).then(() => { settle({id:task.request.id,ok:false,error}); pump(); });
      };
      const abort = () => cancel('SQL call cancelled');
      const task: Task = {request:{...request,id:++ids} as PoolRequest,deadline,executionMs,prepared,settle};
      const timer = setTimeout(() => cancel('timed_out'), Math.max(0, deadline - performance.now()));
      queue.push(task);context?.signal?.addEventListener('abort', abort, {once:true});pump();
    });
  };

  const timedOut = (error: string) => error === 'timed_out';
  return {
    readPolicy:Object.freeze({queryTimeoutMs:caps.timeoutMs}),
    run: async (input, context) => {
      const started = performance.now();
      admit('run', input);
      try {
        const { limit, timeoutMs } = queryBounds(input, caps);
        const bounds: ReadBounds = { limit, timeoutMs, pageLimit: queryBounds(input, caps, input.page).limit, ...(input.outputBytes !== undefined ? { outputBytes: input.outputBytes } : {}) };
        return call<Record<string, QueryOutcome>>({ method: 'run', input, bounds }, timeoutMs + SQL_WALL_OVERHEAD_MS,
          (error) => Object.fromEntries(input.queries.map((q) => [q.name, timedOut(error) ? { error: `<Query name="${q.name}"> ran too long and was stopped (limit ${timeoutMs}ms) — narrow it (filter, aggregate, or LIMIT)`, timedOut: true } : { error }])), context, started);
      } catch { return Object.fromEntries(input.queries.map(q => [q.name, {error:'Invalid SQL read budget'}])); }
    },
    runMany: async (input, context) => {
      const started = performance.now();
      admit('runMany', input);
      try {
        const clamp = (run: { limit?: number; timeoutMs?: number }): ReadBounds => { const { limit, timeoutMs } = queryBounds(run, caps); return { limit, timeoutMs, pageLimit: limit }; };
        // The shared run's bounds last (index -1 in the engine's callback).
        const bounds: ReadBounds[] = [...input.runs.map(clamp), clamp(input.shared ?? {})];
        return call<Array<Record<string, QueryOutcome>>>({ method: 'runMany', input, bounds }, caps.timeoutMs + SQL_WALL_OVERHEAD_MS,
          (error) => input.runs.map((run, i) => Object.fromEntries([...(input.shared?.queries ?? []), ...run.queries].map((q) => [q.name, timedOut(error) ? { error: `<Query name="${q.name}"> ran too long and was stopped (limit ${bounds[i]!.timeoutMs}ms) — narrow it (filter, aggregate, or LIMIT)`, timedOut: true } : { error }]))), context, started);
      } catch { return input.runs.map(run => Object.fromEntries([...(input.shared?.queries ?? []), ...run.queries].map(q => [q.name, {error:'Invalid SQL read budget'}]))); }
    },
    mutate: (input) => {
      admit('mutate', input);
      const bounds = queryBounds(input, { ...caps, timeoutMs: caps.mutationTimeoutMs });
      return call<MutationOutcome>({ method: 'mutate', input, bounds }, bounds.timeoutMs + grace,
        (error) => (timedOut(error) ? { error: `the mutation ran too long and was stopped (limit ${bounds.timeoutMs}ms)`, timedOut: true } : { error }));
    },
    dryRun: (input) => {
      admit('dryRun', input);
      return call<DryRunResult>({ method: 'dryRun', input }, caps.timeoutMs + SQL_WALL_OVERHEAD_MS,
        (error) => ({ errors: input.queries.map((q) => ({ name: q.name, error })), columns: {} }));
    },
    dryRunMutations: (input) => {
      admit('dryRunMutations', input);
      return call<DryRunMutationsResult>({ method: 'dryRunMutations', input }, caps.mutationTimeoutMs + grace,
        (error) => ({ errors: input.mutations.map((m) => ({ name: m.name, error })) }));
    },
    close: async () => {
      closed = true;
      for (const task of queue.splice(0)) task.settle({ id: task.request.id, ok: false, error: 'the SQL engine is closed' });
      await Promise.all([...threads].map(async t=>{const task=t.task;await retire(t);if(task)task.settle({id:task.request.id,ok:false,error:'the SQL engine is closed'});}));
    },
  };
}
