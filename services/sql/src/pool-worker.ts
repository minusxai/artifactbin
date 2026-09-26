/**
 * ONE ENGINE THREAD of the pool (./pool.ts): loads the SQLite engine once and
 * answers one call at a time. Everything it receives is data — the input and
 * the bounds the pool already clamped; the deadline is enforced HERE, inside
 * the statement, by the engine's progress handler. The pool's own watchdog
 * exists only for a thread that stops answering altogether.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { loadSqlite } from './sqlite/index';
import type { SqlExtensions } from './extensions';
import type { PoolRequest, PoolAnswer } from './pool';

const engine = await loadSqlite();
const extensions: SqlExtensions = typeof workerData?.extensions === 'string' ? (await import(workerData.extensions)).default ?? {} : {};

parentPort!.on('message', (request: PoolRequest) => {
  let answer: PoolAnswer;
  try {
    const result = request.method === 'run' ? engine.run(request.input, request.bounds)
      : request.method === 'mutate' ? engine.mutate(request.input, request.bounds, extensions)
        : request.method === 'dryRun' ? engine.dryRun(request.input)
          : engine.dryRunMutations(request.input, extensions);
    answer = { id: request.id, ok: true, result };
  } catch (error) {
    answer = { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  parentPort!.postMessage(answer);
});
parentPort!.postMessage({ ready: true });
