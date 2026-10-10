/** ONE PREPARE THREAD (./draft-compile-pool.ts): loads the compiler and vega once, runs one job at a time. */
import { parentPort } from 'node:worker_threads';
import { renderDraftPreview } from './draft-preview.server';
import { compilePage } from '@/lib/compiled-page/compiler';
import { drawSnapshotCharts } from './charts.server';
import type { DraftCompileAnswer, DraftCompileRequest } from './draft-compile-pool';

const run = (request: DraftCompileRequest): Promise<unknown> => {
  if (request.kind === 'compile') return compilePage(request.input, request.build);
  if (request.kind === 'charts') return drawSnapshotCharts(request.nodes, request.results, request.options);
  return renderDraftPreview(request.input);
};

parentPort!.on('message', (request: DraftCompileRequest) => {
  void run(request).then(
    (value): DraftCompileAnswer => ({ id: request.id, ok: true, value }),
    (error: unknown): DraftCompileAnswer => ({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }),
  ).then((answer) => parentPort!.postMessage(answer));
});
parentPort!.postMessage({ ready: true });
