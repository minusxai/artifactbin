/**
 * Worker threads for editor draft compiles (./draft-compile.server.ts). Each thread loads the
 * compiler once and compiles one draft at a time; a call waits for an idle thread. The input and the
 * answer are data (structured clone); a compile's error comes back as its message. A thread that
 * dies is replaced and its caller fails.
 */
import { Worker } from 'node:worker_threads';
import type { PrepareStoryInput } from './prepare-runtime.server';

export type DraftCompileRequest = { id: number; input: PrepareStoryInput };
export type DraftCompileAnswer = { id: number; ok: true; html: string } | { id: number; ok: false; error: string };

export interface DraftCompilePool {
  readonly size: number;
  compile(input: PrepareStoryInput): Promise<string>;
  close(): Promise<void>;
}

interface Task { request: DraftCompileRequest; resolve: (html: string) => void; reject: (error: Error) => void }
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
      if (answer.ok) task.resolve(answer.html); else task.reject(new Error(answer.error));
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

  return {
    size,
    compile(input) {
      if (closed) return Promise.reject(new Error('the draft compiler is closed'));
      return new Promise<string>((resolve, reject) => {
        queue.push({ request: { id: ++ids, input }, resolve, reject });
        pump();
      });
    },
    async close() {
      closed = true;
      for (const task of queue.splice(0)) task.reject(new Error('the draft compiler is closed'));
      await Promise.all(threads.splice(0).map((t) => t.worker.terminate()));
    },
  };
}
