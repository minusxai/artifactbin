/** ONE DRAFT-COMPILE THREAD (./draft-compile-pool.ts): loads the compiler once, compiles one draft at a time. */
import { parentPort } from 'node:worker_threads';
import { renderDraftPreview } from './draft-preview.server';
import type { DraftCompileAnswer, DraftCompileRequest } from './draft-compile-pool';

parentPort!.on('message', (request: DraftCompileRequest) => {
  void renderDraftPreview(request.input).then(
    (html): DraftCompileAnswer => ({ id: request.id, ok: true, html }),
    (error: unknown): DraftCompileAnswer => ({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }),
  ).then((answer) => parentPort!.postMessage(answer));
});
parentPort!.postMessage({ ready: true });
