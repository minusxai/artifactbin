/**
 * Worker threads for the app's CPU-bound document work (./draft-compile.server.ts): editor draft
 * compiles, a version's page compile and its snapshot's server-drawn charts. On the request thread
 * each of these holds every other request this process answers (a heavy chart set held it ~15 s in
 * production). Each thread loads the compiler and vega once and runs one job at a time; a call waits
 * for an idle thread. The input and the answer are data (structured clone); a job's error comes back
 * as its message. A thread that dies is replaced and its caller fails.
 */
import { Worker } from 'node:worker_threads';
import type { PrepareStoryInput } from './prepare-runtime.server';
import type { CompileInput, CompiledPage, CompilerBuild, DrawnChart } from '@/lib/compiled-page/contract';
import type { JsxNode } from '@/lib/jsx';
import type { ServedResults } from '@/lib/story-runtime/contract';
import type { SnapshotChartOptions } from '@/lib/compiled-page/charts.server';

/** One job a thread runs: a draft preview, a version's compile, or a snapshot's drawn charts. */
type PrepareJob =
  | { kind?: 'draft'; input: PrepareStoryInput }
  | { kind: 'compile'; input: CompileInput; build: CompilerBuild }
  | { kind: 'charts'; nodes: JsxNode[]; results: Pick<ServedResults, 'tables' | 'errors'>; options: SnapshotChartOptions };
export type DraftCompileRequest = { id: number } & PrepareJob;
export type DraftCompileAnswer = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

export interface DraftCompilePool {
  readonly size: number;
  /** An editor draft's preview page. */
  compile(input: PrepareStoryInput): Promise<string>;
  /** A version's compiled page (lib/compiled-page/compiler `compilePage`). */
  compilePage(input: CompileInput, build: CompilerBuild): Promise<CompiledPage>;
  /** A snapshot's server-drawn charts (lib/compiled-page/charts.server `drawSnapshotCharts`). */
  drawCharts(nodes: JsxNode[], results: Pick<ServedResults, 'tables' | 'errors'>, options: SnapshotChartOptions): Promise<Record<string, DrawnChart>>;
  close(): Promise<void>;
}

interface Task { request: DraftCompileRequest; resolve: (value: unknown) => void; reject: (error: Error) => void }
interface Thread { worker: Worker; ready: Promise<void>; task: Task | null }

export function createDraftCompilePool(options: { url: URL; execArgv?: string[]; workers: number }): DraftCompilePool {
  const size = Math.max(1, Math.floor(options.workers));
  const threads: Thread[] = [];
  const queue: Task[] = [];
  let ids = 0;
  let closed = false;

  const spawn = (): Thread => {
    const worker = new Worker(options.url, options.execArgv ? { execArgv: options.execArgv } : {});
    const thread: Thread = { worker, task: null, ready: new Promise((resolve, reject) => {
      const onReady = (m: unknown) => { if ((m as { ready?: boolean })?.ready) { worker.off('message', onReady); resolve(); } };
      worker.on('message', onReady);
      worker.once('error', reject);
    }) };
    thread.ready.catch(() => {});
    worker.on('message', (answer: DraftCompileAnswer | { ready: true }) => {
      if (!('id' in answer) || thread.task?.request.id !== answer.id) return;
      const task = thread.task;
      thread.task = null;
      worker.unref();
      if (answer.ok) task.resolve(answer.value); else task.reject(new Error(answer.error));
      pump();
    });
    const fail = (why: string) => {
      const i = threads.indexOf(thread);
      if (i < 0) return;
      threads.splice(i, 1);
      const task = thread.task;
      thread.task = null;
      void worker.terminate();
      task?.reject(new Error(why));
      pump();
    };
    worker.on('error', (e) => fail(`the draft compiler failed: ${e.message}`));
    worker.on('exit', () => fail('the draft compiler stopped'));
    worker.unref();
    threads.push(thread);
    return thread;
  };

  const pump = () => {
    while (queue.length && !closed) {
      const idle = threads.find((t) => !t.task) ?? (threads.length < size ? spawn() : null);
      if (!idle) return;
      const task = queue.shift()!;
      idle.task = task;
      idle.worker.ref();
      void idle.ready.then(() => { if (idle.task === task) idle.worker.postMessage(task.request); }, () => {});
    }
  };

  const run = <T>(job: PrepareJob): Promise<T> => {
    if (closed) return Promise.reject(new Error('the draft compiler is closed'));
    return new Promise<T>((resolve, reject) => {
      queue.push({ request: { id: ++ids, ...job }, resolve: resolve as (value: unknown) => void, reject });
      pump();
    });
  };

  return {
    size,
    compile: (input) => run<string>({ kind: 'draft', input }),
    compilePage: (input, build) => run<CompiledPage>({ kind: 'compile', input, build }),
    drawCharts: (nodes, results, options) => run<Record<string, DrawnChart>>({ kind: 'charts', nodes, results, options }),
    async close() {
      closed = true;
      for (const task of queue.splice(0)) task.reject(new Error('the draft compiler is closed'));
      await Promise.all(threads.splice(0).map((t) => t.worker.terminate()));
    },
  };
}
