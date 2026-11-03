/**
 * ONE ENGINE THREAD of the pool (./pool.ts): loads the SQLite engine once and
 * answers one call at a time. Everything it receives is data — the input and
 * the bounds the pool already clamped; the deadline is enforced HERE, inside
 * the statement, by the engine's progress handler. The pool's own watchdog
 * exists only for a thread that stops answering altogether.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { loadSqlite, PreparedCache } from './sqlite/index';
import type { SqlExtensions } from './extensions';
import type { PoolRequest, PoolAnswer } from './pool';

const engine = await loadSqlite();
/** This thread's prepared catalog databases (./sqlite/prepared): one call at a time, so one cache. */
const prepared = new PreparedCache(typeof workerData?.preparedBytes === 'number' ? workerData.preparedBytes : undefined);
const extensions: SqlExtensions = typeof workerData?.extensions === 'string' ? (await import(workerData.extensions)).default ?? {} : {};

parentPort!.on('message', (request: PoolRequest) => {
  let answer: PoolAnswer;
  try {
    const result = request.method === 'run' ? engine.run(request.input, request.bounds, prepared)
      : request.method === 'runMany' ? engine.runMany(request.input, (_run, i) => request.bounds.at(i)!)
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
